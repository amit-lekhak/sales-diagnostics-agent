import { google } from '@ai-sdk/google';
import { stepCountIs, streamText } from 'ai';
import { sql } from '@/lib/db';
import { defaultRange } from '@/lib/dates';
import { formatDimensionsPrompt, loadDimensions } from '@/lib/dimensions';
import type { ChatScope, PageContext } from '@/lib/page-context';
import { buildAiTools } from '@/lib/agent/ai-tools';
import { chatRequestSchema } from '@/lib/agent/chat-protocol';
import { systemPrompt } from '@/lib/agent/prompts';
import { ensureGeminiKey } from '@/lib/agent/provider-config';
import { classifyProviderError, type ClassifiedError } from '@/lib/agent/provider-errors';
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

/** Soft ceiling for the whole request so platform maxDuration is not exceeded. */
const ROUTE_BUDGET_MS = Number(process.env.CHAT_ROUTE_BUDGET_MS ?? 58_000);
const ANALYST_TIMEOUT_CAP_MS = Number(process.env.CHAT_ANALYST_TIMEOUT_MS ?? 45_000);
const ANALYST_TIMEOUT_FLOOR_MS = 5_000;

ensureGeminiKey();

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';

function remainingAnalystTimeout(started: number): number {
  const left = ROUTE_BUDGET_MS - (Date.now() - started);
  return Math.max(ANALYST_TIMEOUT_FLOOR_MS, Math.min(ANALYST_TIMEOUT_CAP_MS, left));
}

async function persistProviderError(input: {
  convId: string;
  runId: string;
  scope: ChatScope;
  page: PageContext;
  started: number;
  classified: ClassifiedError;
}) {
  const { convId, runId, scope, page, started, classified } = input;
  const text = classified.userMessage;
  const [msg] = await sql<{ id: string }[]>`
    INSERT INTO messages (conversation_id, role, content, scope, page_context, run_id)
    VALUES (${convId}::uuid, 'assistant', ${text}, ${scope}, ${jsonb(page)}, ${runId}::uuid)
    RETURNING id::text AS id
  `;
  await finishRun(runId, {
    status: 'error',
    latencyMs: Date.now() - started,
    error: `${classified.code}: ${classified.raw}`.slice(0, 2000),
    messageId: msg!.id,
  });
  await sql`
    UPDATE conversations SET updated_at = NOW(), last_page_context = ${jsonb(page)}
    WHERE id = ${convId}::uuid
  `;
  await exportLangfuse({
    id: runId,
    model: MODEL,
    status: 'error',
    latencyMs: Date.now() - started,
    error: classified.code,
  });
  await captureSentry(classified.raw);
  return Response.json({
    conversationId: convId,
    runId,
    text,
    error: classified.code,
    code: classified.code,
    retryAfterMs: classified.retryAfterMs,
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', text: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid_request',
        text: 'Send a non-empty message (max 4000 characters).',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const scope: ChatScope = parsed.data.scope === 'all' ? 'all' : 'page';
  const page = (parsed.data.pageContext ?? {
    page: 'overview',
    pathname: '/',
  }) as PageContext;
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
  const userMessage = parsed.data.message;

  let conversationId = parsed.data.conversationId ?? undefined;
  let runId: string | null = null;
  const started = Date.now();

  try {
    if (!conversationId) {
      const [c] = await sql<{ id: string }[]>`
        INSERT INTO conversations (title, last_page_context)
        VALUES (${userMessage.slice(0, 80)}, ${jsonb(page)})
        RETURNING id::text AS id
      `;
      conversationId = c!.id;
    } else {
      const existing = await sql<{ id: string }[]>`
        SELECT id::text AS id FROM conversations WHERE id = ${conversationId}::uuid
      `;
      if (!existing[0]) {
        return Response.json(
          {
            error: 'conversation_not_found',
            text: 'That conversation was not found. Start a new chat.',
          },
          { status: 404 },
        );
      }
    }
    const convId = conversationId;

    await sql`
      INSERT INTO messages (conversation_id, role, content, scope, page_context)
      VALUES (${convId}::uuid, 'user', ${userMessage}, ${scope}, ${jsonb(page)})
    `;

    runId = await createRun({ conversationId: convId, model: MODEL, scope });
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

    const topic = await classifyTopic(userMessage, runId);
    if ('providerError' in topic && topic.providerError) {
      return persistProviderError({
        convId,
        runId,
        scope,
        page,
        started,
        classified: topic.providerError,
      });
    }
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
      message: userMessage,
      runId,
      recentTurns,
      scope,
      page,
      defaultFrom: range.from,
      defaultTo: range.to,
    });

    if (slotsResult.action === 'provider_error') {
      return persistProviderError({
        convId,
        runId,
        scope,
        page,
        started,
        classified: slotsResult.classified,
      });
    }

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

    if (slotsResult.action === 'fail_open') {
      await addSpan({
        runId,
        kind: 'guard',
        name: 'slot_filler_fail_open',
        startedAt: new Date(),
        payloadOut: { action: 'fail_open', reason: slotsResult.reason },
      });
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

    const analystTimeoutMs = remainingAnalystTimeout(started);
    const result = streamText({
      model: google(MODEL),
      system: systemPrompt(scope, page, range, dimensions, filledSlots),
      messages,
      stopWhen: stepCountIs(8),
      tools: buildAiTools(rt),
      abortSignal: AbortSignal.timeout(analystTimeoutMs),
    });

    async function persistOk(
      text: string,
      usage: { inputTokens?: number; outputTokens?: number } | undefined,
    ) {
      const bodyText = text ?? '';
      await addSpan({
        runId: runId!,
        kind: 'llm',
        name: MODEL,
        startedAt: new Date(started),
        endedAt: new Date(),
        payloadIn: {
          message: userMessage,
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
        VALUES (${convId}::uuid, 'assistant', ${bodyText}, ${scope}, ${jsonb(page)}, ${runId!}::uuid)
        RETURNING id::text AS id
      `;
      await finishRun(runId!, {
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
      await maybeSummarize(convId, runId!);
      await exportLangfuse({
        id: runId!,
        model: MODEL,
        status: 'ok',
        latencyMs: Date.now() - started,
      });
    }

    async function persistStreamError(classified: ClassifiedError) {
      const text = classified.userMessage;
      const [msg] = await sql<{ id: string }[]>`
        INSERT INTO messages (conversation_id, role, content, scope, page_context, run_id)
        VALUES (${convId}::uuid, 'assistant', ${text}, ${scope}, ${jsonb(page)}, ${runId!}::uuid)
        RETURNING id::text AS id
      `;
      await finishRun(runId!, {
        status: 'error',
        latencyMs: Date.now() - started,
        error: `${classified.code}: ${classified.raw}`.slice(0, 2000),
        messageId: msg!.id,
      });
      await sql`
        UPDATE conversations SET updated_at = NOW(), last_page_context = ${jsonb(page)}
        WHERE id = ${convId}::uuid
      `;
      await exportLangfuse({
        id: runId!,
        model: MODEL,
        status: 'error',
        latencyMs: Date.now() - started,
        error: classified.code,
      });
      await captureSentry(classified.raw);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const enqueue = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        enqueue({ type: 'meta', conversationId: convId, runId });
        let persisted = false;
        try {
          // Prefer fullStream so tool progress can surface while waiting on text.
          const full = result.fullStream;
          for await (const part of full) {
            if (part.type === 'tool-call') {
              enqueue({
                type: 'tool',
                phase: 'start',
                name: part.toolName,
                conversationId: convId,
                runId,
              });
            } else if (part.type === 'tool-result') {
              enqueue({
                type: 'tool',
                phase: 'done',
                name: part.toolName,
                conversationId: convId,
                runId,
              });
            } else if (part.type === 'text-delta') {
              const text =
                'text' in part
                  ? String(part.text)
                  : 'delta' in part
                    ? String((part as { delta: unknown }).delta)
                    : '';
              if (text) {
                enqueue({
                  type: 'delta',
                  text,
                  conversationId: convId,
                  runId,
                });
              }
            }
          }
          const text = (await result.text) ?? '';
          const usage = await result.usage;
          try {
            await persistOk(text, usage);
            persisted = true;
            enqueue({ type: 'done', conversationId: convId, runId });
          } catch (persistErr) {
            const classified = classifyProviderError(persistErr);
            await finishRun(runId!, {
              status: 'error',
              latencyMs: Date.now() - started,
              error: classified.raw,
            });
            await captureSentry(classified.raw);
            enqueue({
              type: 'error',
              error:
                'Answer generated but could not be saved. Refresh may lose this reply — try again.',
              code: classified.code,
              retryAfterMs: classified.retryAfterMs,
              conversationId: convId,
              runId,
            });
          }
        } catch (err) {
          const classified = classifyProviderError(err);
          if (!persisted) {
            try {
              await persistStreamError(classified);
              persisted = true;
            } catch {
              await finishRun(runId!, {
                status: 'error',
                latencyMs: Date.now() - started,
                error: classified.raw,
              });
              await captureSentry(classified.raw);
            }
          }
          enqueue({
            type: 'error',
            error: classified.userMessage,
            code: classified.code,
            retryAfterMs: classified.retryAfterMs,
            conversationId: convId,
            runId,
          });
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
    const classified = classifyProviderError(err);
    if (runId) {
      try {
        await finishRun(runId, {
          status: 'error',
          latencyMs: Date.now() - started,
          error: `${classified.code}: ${classified.raw}`.slice(0, 2000),
        });
        await exportLangfuse({
          id: runId,
          model: MODEL,
          status: 'error',
          latencyMs: Date.now() - started,
          error: classified.code,
        });
      } catch {
        // ignore secondary failures
      }
    }
    await captureSentry(classified.raw);
    return Response.json(
      {
        error: classified.code,
        code: classified.code,
        text: classified.userMessage,
        retryAfterMs: classified.retryAfterMs,
        conversationId: conversationId ?? undefined,
        runId: runId ?? undefined,
      },
      { status: 500 },
    );
  }
}
