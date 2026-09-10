import { RunsChart } from '@/components/dashboard/BreakdownChart';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { Pagination } from '@/components/dashboard/FilterBar';
import { dateTime } from '@/lib/format';
import { opsSummary } from '@/lib/queries';
import { qs, spPage } from '@/lib/search';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const page = spPage(sp, 'page');
  const { totals, recent, recentTotal, pageSize, toolFails, daily } = await opsSummary({
    page,
  });
  const t = totals ?? {
    runs: 0,
    errors: 0,
    avg_latency: null,
    p50: null,
    p95: null,
    tokens_in: 0,
    tokens_out: 0,
  };
  const hrefFor = (p: number) => `/ops${qs({ page: p })}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Agent ops</h1>
      <p className="mt-1 text-sm text-(--muted)">
        Last 7 days of traced chat runs, stored in Postgres.
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
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
        <section className="mt-6 rounded-xl border border-(--line) bg-(--panel) p-4">
          <h2 className="mb-3 text-sm font-medium">Runs vs errors (7 days)</h2>
          <RunsChart data={daily} />
        </section>
      )}
      <section className="mt-6 rounded-xl border border-(--line) bg-(--panel) p-4">
        <h2 className="mb-3 text-sm font-medium">Tool failures</h2>
        {toolFails.length === 0 ? (
          <p className="text-sm text-(--muted)">None yet.</p>
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
      <section className="mt-6 rounded-xl border border-(--line) bg-(--panel) p-4">
        <h2 className="mb-3 text-sm font-medium">Recent runs</h2>
        {recent.length === 0 ? (
          <EmptyState
            title="No runs yet"
            body="Ask the floating chat a question to create a trace."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-(--muted)">
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
                    <tr key={r.id} className="border-t border-(--line)">
                      <td className="py-2 whitespace-nowrap">{dateTime(r.created_at)}</td>
                      <td>{r.status}</td>
                      <td className="whitespace-nowrap">{r.latency_ms ?? '—'} ms</td>
                      <td className="whitespace-nowrap">
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
            </div>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={recentTotal}
              hrefFor={hrefFor}
            />
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-(--line) bg-(--panel) p-4">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
