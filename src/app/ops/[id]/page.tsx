import { EmptyState } from '@/components/dashboard/EmptyState';
import { dateTime, num, spanRange } from '@/lib/format';
import { runById, runSpans } from '@/lib/queries';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const run = await runById(id);
  if (!run) notFound();
  const spans = await runSpans(id);

  return (
    <div>
      <Link href="/ops" className="text-sm underline">
        Back to ops
      </Link>
      <h1 className="mt-4 break-all text-2xl font-semibold">Run {id.slice(0, 8)}</h1>
      <section className="mt-4 rounded-xl border border-(--line) bg-(--panel) p-4 text-sm">
        <p>
          <span className="text-(--muted)">Status</span> {run.status}
          {' · '}
          <span className="text-(--muted)">Latency</span>{' '}
          {run.latency_ms != null ? `${run.latency_ms} ms` : '—'}
          {' · '}
          <span className="text-(--muted)">Prompt / completion</span>{' '}
          {num(run.input_tokens ?? 0)} / {num(run.output_tokens ?? 0)}
        </p>
        <p className="mt-1 text-(--muted)">
          {run.model}
          {run.scope ? ` · ${run.scope}` : ''}
          {' · '}
          {dateTime(run.created_at)}
        </p>
        {run.error && <p className="mt-2 text-orange-800">{run.error}</p>}
      </section>
      {spans.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No spans" body="This run has no recorded spans." />
        </div>
      ) : (
        <ol className="mt-6 space-y-3">
          {spans.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-(--line) bg-(--panel) p-4 text-sm"
            >
              <p className="font-medium">
                {s.kind} · {s.name}
              </p>
              <p className="text-xs text-(--muted)">
                {spanRange(s.started_at, s.ended_at)}
                {spanTokenLabel(s)}
              </p>
              {s.error && <p className="mt-2 text-orange-800">{s.error}</p>}
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-stone-100 p-2 text-xs">
                {JSON.stringify({ input: s.input, output: s.output }, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function spanTokenLabel(s: {
  kind: string;
  token_count: number | null;
  output: unknown;
}): string {
  const out =
    s.output && typeof s.output === 'object' && !Array.isArray(s.output)
      ? (s.output as Record<string, unknown>)
      : null;
  const inn = typeof out?.inputTokens === 'number' ? out.inputTokens : null;
  const o = typeof out?.outputTokens === 'number' ? out.outputTokens : null;
  const compaction = s.kind === 'summarize' ? ' (compaction, not in run total)' : '';
  if (inn != null || o != null) {
    return ` · ${num(inn ?? 0)} in / ${num(o ?? 0)} out${compaction}`;
  }
  if (s.token_count != null) {
    return ` · ${num(s.token_count)} tokens${compaction}`;
  }
  return '';
}
