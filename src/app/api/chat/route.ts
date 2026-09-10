import { google } from '@ai-sdk/google';
import { stepCountIs, streamText } from 'ai';
import { sql } from '@/lib/db';
import { defaultRange } from '@/lib/dates';
import { formatDimensionsPrompt, loadDimensions } from '@/lib/dimensions';
import type { ChatScope, PageContext } from '@/lib/page-context';
import { buildAiTools } from '@/lib/agent/ai-tools';
import { systemPrompt } from '@/lib/agent/prompts';
import { loadConversationContext, maybeSummarize } from '@/lib/agent/summarize';
import { fillSlots } from '@/lib/agent/slot-fill';
import { classifyTopic, SCOPE_REFUSAL_TEXT } from '@/lib/agent/topic-guard';
import type { ToolRuntime } from '@/lib/agent/tools';
import {
  addSpan,
  captureSentry,
  createRun,
  exportLangfuse,
  finishRun,
} from '@/lib/agent/tracer';

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
}

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';

export async function POST(req: Request) {
  const body = (await req.json()) as {
    conversationId?: string;
    message: string;
    scope?: ChatScope;
    pageContext?: PageContext;
  };
  const scope: ChatScope = body.scope === 'all' ? 'all' : 'page';
  const page = body.pageContext ?? { page: 'overview', pathname: '/' };
  const range = {
    from: page.from ?? defaultRange().from,
    to: page.to ?? defaultRange().to,
  };
  const filters = {
    ...range,
    storeId: page.storeId,
    regionId: page.regionId,
    productId: page.productId,
  };

  let conversationId = body.conversationId;
  if (!conversationId) {
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO conversations (title, last_page_context)
      VALUES (${body.message.slice(0, 80)}, ${jsonb(page)})
      RETURNING id::text AS id
    `;
    conversationId = c!.id;
  }
  const convId = conversationId;

  await sql`
    INSERT INTO messages (conversation_id, role, content, scope, page_context)
    VALUES (${convId}::uuid, 'user', ${body.message}, ${scope}, ${jsonb(page)})
  `;

  const runId = await createRun({ conversationId: convId, model: MODEL, scope });
  const started = Date.now();
  const rt: ToolRuntime = { runId, scope, filters };

  if (!process.env.GEMINI_API_KEY) {
    await addSpan({
      runId,
      kind: 'llm',
      name: 'missing_key',
      startedAt: new Date(started),
      error: 'GEMINI_API_KEY missing',
    });
    const text =
      'GEMINI_API_KEY is missing. Set it in .env.local to answer with live model calls. Dashboard numbers still come from Postgres.';
    const [msg] = await sql<{ id: string }[]>`
      INSERT INTO messages (conversation_id, role, content, scope, page_context, run_id)
      VALUES (${convId}::uuid, 'assistant', ${text}, ${scope}, ${jsonb(page)}, ${runId}::uuid)
      RETURNING id::text AS id
    `;
    await finishRun(runId, {
      status: 'error',
      latencyMs: Date.now() - started,
      error: 'GEMINI_API_KEY missing',
      messageId: msg!.id,
    });
    return Response.json({ conversationId: convId, runId, text, error: 'missing_key' });
  }

  const topic = await classifyTopic(body.message, runId);
  if (!topic.allowed) {
    const text = SCOPE_REFUSAL_TEXT;
    const [msg] = await sql<{ id: string }[]>`
      INSERT INTO messages (conversation_id, role, content, scope, page_context, run_id)
      VALUES (${convId}::uuid, 'assistant', ${text}, ${scope}, ${jsonb(page)}, ${runId}::uuid)
      RETURNING id::text AS id
    `;
    await finishRun(runId, {
      status: 'ok',
      latencyMs: Date.now() - started,
      messageId: msg!.id,
    });
    await sql`
      UPDATE conversations SET updated_at = NOW(), last_page_context = ${jsonb(page)}
      WHERE id = ${convId}::uuid
    `;
    await exportLangfuse({
      id: runId,
      model: MODEL,
      status: 'ok',
      latencyMs: Date.now() - started,
    });
    return Response.json({ conversationId: convId, runId, text });
  }

  const history = await loadConversationContext(convId);
  // Current user message is already persisted; use prior turns for slot inheritance.
  const prior = history.recent.slice(0, -1);
  const recentTurns = prior.slice(-4);
  const slotsResult = await fillSlots({
    message: body.message,
    runId,
    recentTurns,
    scope,
    page,
    defaultFrom: range.from,
    defaultTo: range.to,
  });

  if (slotsResult.action === 'clarify' || slotsResult.action === 'soft_refuse') {
    const text = slotsResult.text;
    const [msg] = await sql<{ id: string }[]>`
      INSERT INTO messages (conversation_id, role, content, scope, page_context, run_id)
      VALUES (${convId}::uuid, 'assistant', ${text}, ${scope}, ${jsonb(page)}, ${runId}::uuid)
      RETURNING id::text AS id
    `;
    await finishRun(runId, {
      status: 'ok',
      latencyMs: Date.now() - started,
      messageId: msg!.id,
    });
    await sql`
      UPDATE conversations SET updated_at = NOW(), last_page_context = ${jsonb(page)}
      WHERE id = ${convId}::uuid
    `;
    await exportLangfuse({
      id: runId,
      model: MODEL,
      status: 'ok',
      latencyMs: Date.now() - started,
    });
    return Response.json({ conversationId: convId, runId, text });
  }

  const filledSlots = slotsResult.action === 'ready' ? slotsResult.slots : null;

  const dimensions = formatDimensionsPrompt(await loadDimensions());
  const messages = [
    ...(history.summary
      ? [
          {
            role: 'system' as const,
            content: `Conversation summary:\n${history.summary}`,
          },
        ]
      : []),
    ...history.recent.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  ];

  try {
    const result = streamText({
      model: google(MODEL),
      system: systemPrompt(scope, page, range, dimensions, filledSlots),
      messages,
      stopWhen: stepCountIs(8),
      tools: buildAiTools(rt),
    });

    async function persistOk(
      text: string,
      usage: { inputTokens?: number; outputTokens?: number } | undefined,
    ) {
      const bodyText = text ?? '';
      await addSpan({
        runId,
        kind: 'llm',
        name: MODEL,
        startedAt: new Date(started),
        endedAt: new Date(),
        payloadIn: {
          message: body.message,
          history: messages.length,
          scope,
          page: page.page,
        },
        payloadOut: {
          chars: bodyText.length,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
        },
        tokenCount: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
      });
      const [msg] = await sql<{ id: string }[]>`
        INSERT INTO messages (conversation_id, role, content, scope, page_context, run_id)
        VALUES (${convId}::uuid, 'assistant', ${bodyText}, ${scope}, ${jsonb(page)}, ${runId}::uuid)
        RETURNING id::text AS id
      `;
      await finishRun(runId, {
        status: 'ok',
        latencyMs: Date.now() - started,
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        messageId: msg!.id,
      });
      await sql`
        UPDATE conversations SET updated_at = NOW(), last_page_context = ${jsonb(page)}
        WHERE id = ${convId}::uuid
      `;
      await maybeSummarize(convId, runId);
      await exportLangfuse({
        id: runId,
        model: MODEL,
        status: 'ok',
        latencyMs: Date.now() - started,
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'meta', conversationId: convId, runId })}\n\n`,
          ),
        );
        let persisted = false;
        try {
          for await (const delta of result.textStream) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`,
              ),
            );
          }
          const text = (await result.text) ?? '';
          const usage = await result.usage;
          try {
            await persistOk(text, usage);
            persisted = true;
          } catch (persistErr) {
            const message =
              persistErr instanceof Error ? persistErr.message : String(persistErr);
            await finishRun(runId, {
              status: 'error',
              latencyMs: Date.now() - started,
              error: message,
            });
            await captureSentry(message);
          }
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'done', conversationId: convId, runId })}\n\n`,
            ),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!persisted) {
            await finishRun(runId, {
              status: 'error',
              latencyMs: Date.now() - started,
              error: message,
            });
          }
          await captureSentry(message);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', error: message })}\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(runId, {
      status: 'error',
      latencyMs: Date.now() - started,
      error: message,
    });
    await captureSentry(message);
    return Response.json(
      { error: message, conversationId: convId, runId },
      { status: 500 },
    );
  }
}
