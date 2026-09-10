import { google } from '@ai-sdk/google';
import { generateText, stepCountIs } from 'ai';
import { buildAiTools } from '../src/lib/agent/ai-tools';
import { systemPrompt } from '../src/lib/agent/prompts';
import { ensureGeminiKey } from '../src/lib/agent/provider-config';
import { classifyProviderError } from '../src/lib/agent/provider-errors';
import { fillSlots } from '../src/lib/agent/slot-fill';
import { classifyTopic, SCOPE_REFUSAL_TEXT } from '../src/lib/agent/topic-guard';
import type { ToolRuntime } from '../src/lib/agent/tools';
import { createRun, finishRun } from '../src/lib/agent/tracer';
import { defaultRange } from '../src/lib/dates';
import { formatDimensionsPrompt, loadDimensions } from '../src/lib/dimensions';
import type { ChatScope, PageContext } from '../src/lib/page-context';
import type { ToolInvocation } from './score';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
const AGENT_TIMEOUT_MS = Number(process.env.EVAL_AGENT_TIMEOUT_MS ?? 90_000);

export type AgentRunResult = {
  text: string;
  tools: ToolInvocation[];
  latencyMs: number;
  error?: string;
  errorCode?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export async function runAgent(input: {
  question: string;
  scope: ChatScope;
  page: PageContext;
  recentTurns?: { role: string; content: string }[];
}): Promise<AgentRunResult> {
  ensureGeminiKey();
  const range = {
    from: input.page.from ?? defaultRange().from,
    to: input.page.to ?? defaultRange().to,
  };
  const filters = {
    ...range,
    storeId: input.page.storeId,
    regionId: input.page.regionId,
    productId: input.page.productId,
  };
  const runId = await createRun({
    conversationId: null,
    model: MODEL,
    scope: input.scope,
  });
  const rt: ToolRuntime = { runId, scope: input.scope, filters };
  const started = Date.now();
  try {
    const topic = await classifyTopic(input.question, runId);
    if ('providerError' in topic && topic.providerError) {
      await finishRun(runId, {
        status: 'error',
        latencyMs: Date.now() - started,
        error: `${topic.providerError.code}: ${topic.providerError.raw}`.slice(0, 2000),
      });
      return {
        text: topic.providerError.userMessage,
        tools: [],
        latencyMs: Date.now() - started,
        error: topic.providerError.raw,
        errorCode: topic.providerError.code,
      };
    }
    if (!topic.allowed) {
      await finishRun(runId, {
        status: 'ok',
        latencyMs: Date.now() - started,
      });
      return {
        text: SCOPE_REFUSAL_TEXT,
        tools: [],
        latencyMs: Date.now() - started,
      };
    }

    const recentTurns = input.recentTurns ?? [];
    const slotsResult = await fillSlots({
      message: input.question,
      runId,
      recentTurns,
      scope: input.scope,
      page: input.page,
      defaultFrom: range.from,
      defaultTo: range.to,
    });
    if (slotsResult.action === 'provider_error') {
      await finishRun(runId, {
        status: 'error',
        latencyMs: Date.now() - started,
        error: `${slotsResult.classified.code}: ${slotsResult.classified.raw}`.slice(
          0,
          2000,
        ),
      });
      return {
        text: slotsResult.classified.userMessage,
        tools: [],
        latencyMs: Date.now() - started,
        error: slotsResult.classified.raw,
        errorCode: slotsResult.classified.code,
      };
    }
    if (slotsResult.action === 'clarify' || slotsResult.action === 'soft_refuse') {
      await finishRun(runId, {
        status: 'ok',
        latencyMs: Date.now() - started,
      });
      return {
        text: slotsResult.text,
        tools: [],
        latencyMs: Date.now() - started,
      };
    }
    const filledSlots = slotsResult.action === 'ready' ? slotsResult.slots : null;

    const dimensions = formatDimensionsPrompt(await loadDimensions());
    const historyMessages = recentTurns.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    const result = await generateText({
      model: google(MODEL),
      system: systemPrompt(input.scope, input.page, range, dimensions, filledSlots),
      messages: [...historyMessages, { role: 'user', content: input.question }],
      stopWhen: stepCountIs(8),
      tools: buildAiTools(rt),
      abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    const tools: ToolInvocation[] = result.toolResults.map((tr) => ({
      name: String(tr.toolName),
      input: asRecord(tr.input),
      output: tr.output,
    }));
    await finishRun(runId, {
      status: 'ok',
      latencyMs: Date.now() - started,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
    });
    return {
      text: result.text ?? '',
      tools,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const classified = classifyProviderError(err);
    await finishRun(runId, {
      status: 'error',
      latencyMs: Date.now() - started,
      error: `${classified.code}: ${classified.raw}`.slice(0, 2000),
    });
    return {
      text: '',
      tools: [],
      latencyMs: Date.now() - started,
      error: classified.raw,
      errorCode: classified.code,
    };
  }
}
