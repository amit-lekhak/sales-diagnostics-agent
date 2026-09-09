import { FilterBar } from '@/components/dashboard/FilterBar';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { contextTables } from '@/lib/queries';
import { rangeFromSearch } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function ContextPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = rangeFromSearch(sp);
  const { holidays, weather, events, news } = await contextTables(range);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Context</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Stored holidays, weather, company events, and news the agent can join to sales.
      </p>
      <div className="mt-6">
        <FilterBar action="/context" from={range.from} to={range.to} />
      </div>
      <Section title="Holidays">
        {holidays.length === 0 ? (
          <EmptyState title="No holidays in range" body="Widen dates." />
        ) : (
          <ul className="text-sm">
            {holidays.map((h) => (
              <li
                key={`${h.date}-${h.name}`}
                className="border-t border-[var(--line)] py-2"
              >
                {h.date} · {h.name} {h.region ? `(${h.region})` : '(national)'}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Company events">
        {events.length === 0 ? (
          <EmptyState title="No events" body="Nothing overlapping this window." />
        ) : (
          <ul className="text-sm">
            {events.map((e) => (
              <li
                key={`${e.starts_on}-${e.type}`}
                className="border-t border-[var(--line)] py-2"
              >
                <span className="font-medium">{e.type}</span> {e.starts_on}–{e.ends_on}
                {e.store ? ` · ${e.store}` : ''} — {e.notes}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Weather (sample)">
        <div className="max-h-80 overflow-auto text-sm">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--muted)]">
                <th className="py-1">Date</th>
                <th>Store</th>
                <th>Rain mm</th>
                <th>Temp</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {weather.map((w, i) => (
                <tr
                  key={`${w.date}-${w.store}-${i}`}
                  className="border-t border-[var(--line)]"
                >
                  <td className="py-1">{w.date}</td>
                  <td>{w.store}</td>
                  <td>{w.rain_mm}</td>
                  <td>{w.temp_c}°C</td>
                  <td>{w.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="News">
        {news.map((n) => (
          <article key={n.title} className="border-t border-[var(--line)] py-3 text-sm">
            <p className="font-medium">{n.title}</p>
            <p className="text-xs text-[var(--muted)]">
              {n.source} · {n.published_at.slice(0, 10)}
            </p>
            <p className="mt-1 text-[var(--muted)]">{n.body}</p>
          </article>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
