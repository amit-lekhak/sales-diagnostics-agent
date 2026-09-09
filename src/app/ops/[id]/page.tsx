import { EmptyState } from '@/components/dashboard/EmptyState';
import { runSpans } from '@/lib/queries';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const spans = await runSpans(id);
  return (
    <div>
      <Link href="/ops" className="text-sm underline">
        Back to ops
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Run {id.slice(0, 8)}</h1>
      {spans.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No spans" body="This run has no recorded spans." />
        </div>
      ) : (
        <ol className="mt-6 space-y-3">
          {spans.map((s) => (
            <li
              key={s.id}
              className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 text-sm"
            >
              <p className="font-medium">
                {s.kind} · {s.name}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {s.started_at} → {s.ended_at ?? 'open'}
                {s.token_count != null ? ` · ${s.token_count} tokens` : ''}
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
