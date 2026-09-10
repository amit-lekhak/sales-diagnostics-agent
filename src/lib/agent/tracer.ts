import { sql } from '../db';

export type SpanKind = 'llm' | 'tool' | 'sql' | 'embed' | 'summarize' | 'guard';

export async function createRun(input: {
  conversationId: string | null;
  model: string;
  scope: string;
}) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO agent_runs (conversation_id, model, status, scope)
    VALUES (${input.conversationId}::uuid, ${input.model}, 'running', ${input.scope})
    RETURNING id::text AS id
  `;
  return row!.id;
}

export async function finishRun(
  runId: string,
  patch: {
    status: string;
    latencyMs: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    error?: string | null;
    messageId?: string | null;
  },
) {
  await sql`
    UPDATE agent_runs
    SET status = ${patch.status},
        latency_ms = ${patch.latencyMs},
        input_tokens = ${patch.inputTokens ?? null},
        output_tokens = ${patch.outputTokens ?? null},
        error = ${patch.error ?? null},
        message_id = ${patch.messageId ?? null}::uuid
    WHERE id = ${runId}::uuid
  `;
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export async function addSpan(input: {
  runId: string;
  parentSpanId?: string | null;
  kind: SpanKind;
  name: string;
  startedAt: Date;
  endedAt?: Date;
  payloadIn?: unknown;
  payloadOut?: unknown;
  error?: string | null;
  tokenCount?: number | null;
}) {
  const startedAt = input.startedAt.toISOString();
  const endedAt = (input.endedAt ?? new Date()).toISOString();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO agent_spans (
      run_id, parent_span_id, kind, name, started_at, ended_at, input, output, error, token_count
    ) VALUES (
      ${input.runId}::uuid,
      ${input.parentSpanId ?? null}::uuid,
      ${input.kind},
      ${input.name},
      ${startedAt}::timestamptz,
      ${endedAt}::timestamptz,
      ${input.payloadIn == null ? sql`NULL` : jsonb(input.payloadIn)},
      ${input.payloadOut == null ? sql`NULL` : jsonb(truncateJson(input.payloadOut))},
      ${input.error ?? null},
      ${input.tokenCount ?? null}
    )
    RETURNING id::text AS id
  `;
  return row!.id;
}

function truncateJson(value: unknown): unknown {
  const raw = JSON.stringify(value);
  if (raw.length < 8000) return JSON.parse(raw) as unknown;
  return { truncated: true, preview: raw.slice(0, 4000) };
}

export async function exportLangfuse(run: {
  id: string;
  model: string;
  status: string;
  latencyMs: number;
  error?: string | null;
}) {
  const secret = process.env.LANGFUSE_SECRET_KEY;
  const pub = process.env.LANGFUSE_PUBLIC_KEY;
  if (!secret || !pub) return;
  const host = process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com';
  const auth = Buffer.from(`${pub}:${secret}`).toString('base64');
  try {
    await fetch(`${host}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        batch: [
          {
            type: 'trace-create',
            id: run.id,
            timestamp: new Date().toISOString(),
            body: {
              id: run.id,
              name: 'sales-chat',
              metadata: {
                model: run.model,
                status: run.status,
                latencyMs: run.latencyMs,
              },
            },
          },
        ],
      }),
    });
  } catch {
    // optional
  }
}

export async function captureSentry(message: string) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  console.error('[sentry]', message);
}
