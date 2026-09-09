import { google } from '@ai-sdk/google';
import { stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { defaultRange } from '@/lib/dates';
import type { ChatScope, PageContext } from '@/lib/page-context';
import { systemPrompt } from '@/lib/agent/prompts';
import { loadConversationContext, maybeSummarize } from '@/lib/agent/summarize';
import {
  explainChange,
  listContextEvents,
  metricTools,
  searchNews,
  type ToolRuntime,
} from '@/lib/agent/tools';
import {
  addSpan,
  captureSentry,
  createRun,
  exportLangfuse,
  finishRun,
} from '@/lib/agent/tracer';
import type { MetricName } from '@/lib/metrics';

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
  const mt = metricTools(rt);

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

  const history = await loadConversationContext(convId);
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

  const metricEnum = z.enum(['net_sales', 'units', 'aov']);
  const periodEnum = z.enum(['page', 'last_month', 'last_quarter']).optional();

  try {
    const result = streamText({
      model: google(MODEL),
      system: systemPrompt(scope, page, range),
      messages,
      stopWhen: stepCountIs(8),
      tools: {
        get_metric: tool({
          description:
            'Return a named metric for a date range. Uses the semantic layer, never raw SQL from the model. Pass period last_month or last_quarter instead of guessing dates.',
          inputSchema: z.object({
            metric: metricEnum,
            period: periodEnum,
            from: z.string().optional(),
            to: z.string().optional(),
            storeId: z.number().optional(),
            regionId: z.number().optional(),
          }),
          execute: async (args) =>
            mt.get_metric({ ...args, metric: args.metric as MetricName }),
        }),
        breakdown: tool({
          description: 'Break a period of net sales into region, store, or SKU slices.',
          inputSchema: z.object({
            dimension: z.enum(['region', 'store', 'sku']),
            period: periodEnum,
            from: z.string().optional(),
            to: z.string().optional(),
            storeId: z.number().optional(),
            regionId: z.number().optional(),
            limit: z.number().optional(),
          }),
          execute: async (args) => mt.breakdown(args),
        }),
        compare_periods: tool({
          description:
            'Compare a metric to the prior window of equal length, or year-over-year.',
          inputSchema: z.object({
            metric: metricEnum,
            period: periodEnum,
            from: z.string().optional(),
            to: z.string().optional(),
            mode: z.enum(['prior', 'yoy']).optional(),
            storeId: z.number().optional(),
            regionId: z.number().optional(),
          }),
          execute: async (args) =>
            mt.compare_periods({ ...args, metric: args.metric as MetricName }),
        }),
        explain_change: tool({
          description:
            'Decompose a net-sales change vs the prior period by store/region/SKU. Includes unexplained remainder.',
          inputSchema: z.object({
            period: periodEnum,
            from: z.string().optional(),
            to: z.string().optional(),
            dimension: z.enum(['region', 'store', 'sku']).optional(),
            storeId: z.number().optional(),
            regionId: z.number().optional(),
          }),
          execute: async (args) => explainChange(rt, args),
        }),
        list_context_events: tool({
          description:
            'Holidays, stored weather, and company events overlapping a date window. Correlation, not causation.',
          inputSchema: z.object({
            period: periodEnum,
            from: z.string().optional(),
            to: z.string().optional(),
            storeId: z.number().optional(),
            regionId: z.number().optional(),
          }),
          execute: async (args) => listContextEvents(rt, args),
        }),
        search_news: tool({
          description: 'Semantic search over ingested news chunks in pgvector.',
          inputSchema: z.object({
            query: z.string(),
            period: periodEnum,
            from: z.string().optional(),
            to: z.string().optional(),
          }),
          execute: async (args) => searchNews(rt, args),
        }),
      },
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
        payloadOut: { chars: bodyText.length },
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
