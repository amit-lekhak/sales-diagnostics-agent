import { RunsChart } from '@/components/dashboard/BreakdownChart';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { opsSummary } from '@/lib/queries';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function OpsPage() {
  const { totals, recent, toolFails, daily } = await opsSummary();
  const t = totals ?? {
    runs: 0,
    errors: 0,
    avg_latency: null,
    p50: null,
    p95: null,
    tokens_in: 0,
    tokens_out: 0,
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Agent ops</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Last 7 days of traced chat runs, stored in Postgres.
      </p>
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <Stat label="Runs" value={String(t.runs)} />
        <Stat label="Errors" value={String(t.errors)} />
        <Stat
          label="p50 latency"
          value={t.p50 != null ? `${Math.round(t.p50)} ms` : '—'}
        />
        <Stat
          label="p95 latency"
          value={t.p95 != null ? `${Math.round(t.p95)} ms` : '—'}
        />
        <Stat label="Tokens in" value={String(t.tokens_in ?? 0)} />
        <Stat label="Tokens out" value={String(t.tokens_out ?? 0)} />
      </div>
      {daily.length > 0 && (
        <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <h2 className="mb-3 text-sm font-medium">Runs vs errors (7 days)</h2>
          <RunsChart data={daily} />
        </section>
      )}
      <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="mb-3 text-sm font-medium">Tool failures</h2>
        {toolFails.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">None yet.</p>
        ) : (
          <ul className="text-sm">
            {toolFails.map((f) => (
              <li key={f.name}>
                {f.name}: {f.fails}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="mb-3 text-sm font-medium">Recent runs</h2>
        {recent.length === 0 ? (
          <EmptyState
            title="No runs yet"
            body="Ask the floating chat a question to create a trace."
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--muted)]">
              <tr>
                <th className="py-1">When</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Tokens</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} className="border-t border-[var(--line)]">
                  <td className="py-2">{r.created_at.slice(0, 19).replace('T', ' ')}</td>
                  <td>{r.status}</td>
                  <td>{r.latency_ms ?? '—'} ms</td>
                  <td>
                    {r.input_tokens ?? 0} / {r.output_tokens ?? 0}
                  </td>
                  <td>
                    <Link className="underline" href={`/ops/${r.id}`}>
                      {r.scope ?? 'trace'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
