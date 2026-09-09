import { FilterBar, Pagination } from '@/components/dashboard/FilterBar';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { contextTables } from '@/lib/queries';
import { qs, rangeFromSearch, spPage } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function ContextPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = rangeFromSearch(sp);
  const hPage = spPage(sp, 'hPage');
  const ePage = spPage(sp, 'ePage');
  const wPage = spPage(sp, 'wPage');
  const nPage = spPage(sp, 'nPage');
  const { holidays, weather, events, news } = await contextTables(range, {
    holidays: hPage,
    events: ePage,
    weather: wPage,
    news: nPage,
  });

  const hrefFor = (key: 'hPage' | 'ePage' | 'wPage' | 'nPage', page: number) =>
    `/context${qs({
      from: range.from,
      to: range.to,
      hPage: key === 'hPage' ? page : hPage,
      ePage: key === 'ePage' ? page : ePage,
      wPage: key === 'wPage' ? page : wPage,
      nPage: key === 'nPage' ? page : nPage,
    })}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Context</h1>
      <p className="mt-1 text-sm text-(--muted)">
        Stored holidays, weather, company events, and news the agent can join to sales.
      </p>
      <div className="mt-6">
        <FilterBar action="/context" from={range.from} to={range.to} />
      </div>
      <Section title="Holidays">
        {holidays.rows.length === 0 ? (
          <EmptyState title="No holidays in range" body="Widen dates." />
        ) : (
          <ul className="text-sm">
            {holidays.rows.map((h) => (
              <li key={`${h.date}-${h.name}`} className="border-t border-(--line) py-2">
                {h.date} · {h.name} {h.region ? `(${h.region})` : '(national)'}
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={holidays.page}
          pageSize={holidays.pageSize}
          total={holidays.total}
          hrefFor={(p) => hrefFor('hPage', p)}
        />
      </Section>
      <Section title="Company events">
        {events.rows.length === 0 ? (
          <EmptyState title="No events" body="Nothing overlapping this window." />
        ) : (
          <ul className="text-sm">
            {events.rows.map((e) => (
              <li
                key={`${e.starts_on}-${e.type}`}
                className="border-t border-(--line) py-2"
              >
                <span className="font-medium">{e.type}</span> {e.starts_on}–{e.ends_on}
                {e.store ? ` · ${e.store}` : ''} — {e.notes}
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={events.page}
          pageSize={events.pageSize}
          total={events.total}
          hrefFor={(p) => hrefFor('ePage', p)}
        />
      </Section>
      <Section title="Weather">
        {weather.rows.length === 0 ? (
          <EmptyState title="No weather in range" body="Widen dates." />
        ) : (
          <div className="text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase text-(--muted)">
                  <th className="py-1">Date</th>
                  <th>Store</th>
                  <th>Rain mm</th>
                  <th>Temp</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {weather.rows.map((w, i) => (
                  <tr
                    key={`${w.date}-${w.store}-${i}`}
                    className="border-t border-(--line)"
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
        )}
        <Pagination
          page={weather.page}
          pageSize={weather.pageSize}
          total={weather.total}
          hrefFor={(p) => hrefFor('wPage', p)}
        />
      </Section>
      <Section title="News">
        {news.rows.length === 0 ? (
          <EmptyState title="No news in range" body="Widen dates." />
        ) : (
          news.rows.map((n) => (
            <article key={n.title} className="border-t border-(--line) py-3 text-sm">
              <p className="font-medium">{n.title}</p>
              <p className="text-xs text-(--muted)">
                {n.source} · {n.published_at.slice(0, 10)}
              </p>
              <p className="mt-1 text-(--muted)">{n.body}</p>
            </article>
          ))
        )}
        <Pagination
          page={news.page}
          pageSize={news.pageSize}
          total={news.total}
          hrefFor={(p) => hrefFor('nPage', p)}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-(--line) bg-(--panel) p-4">
      <h2 className="mb-2 text-sm font-medium">{title}</h2>
      {children}
    </section>
  );
}
