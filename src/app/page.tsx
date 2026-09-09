import { FilterBar } from '@/components/dashboard/FilterBar';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { SalesChart } from '@/components/dashboard/SalesChart';
import { priorPeriod } from '@/lib/dates';
import { money } from '@/lib/format';
import { breakdown, kpiBundle, seriesByDay } from '@/lib/metrics';
import { listStores } from '@/lib/queries';
import { rangeFromSearch, spStr } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = rangeFromSearch(sp);
  const storeId = spStr(sp, 'storeId') ? Number(spStr(sp, 'storeId')) : undefined;
  const filters = { ...range, storeId };
  const prior = priorPeriod(range);
  const stores = await listStores();
  const [kpis, priorKpis, series, topStores, topSkus] = await Promise.all([
    kpiBundle(filters),
    kpiBundle({ ...prior, storeId }),
    seriesByDay(filters),
    breakdown('store', filters, 5),
    breakdown('sku', filters, 5),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Overview</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Paid retail sales for Northstar Mart. Chat in the corner can explain these
        numbers.
      </p>
      <div className="mt-6">
        <FilterBar
          action="/"
          from={range.from}
          to={range.to}
          storeId={storeId ? String(storeId) : ''}
          stores={stores}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Net sales" value={kpis.net_sales} prior={priorKpis.net_sales} />
        <KpiCard
          label="Units"
          value={kpis.units}
          prior={priorKpis.units}
          format="number"
        />
        <KpiCard label="AOV" value={kpis.aov} prior={priorKpis.aov} />
      </div>
      <section className="mt-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="mb-3 text-sm font-medium">Daily net sales</h2>
        <SalesChart data={series} />
      </section>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <h2 className="mb-3 text-sm font-medium">Top stores</h2>
          <ul className="space-y-2 text-sm">
            {topStores.map((r) => (
              <li key={r.key} className="flex justify-between">
                <span>{r.label}</span>
                <span>{money(r.net_sales)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <h2 className="mb-3 text-sm font-medium">Top SKUs</h2>
          <ul className="space-y-2 text-sm">
            {topSkus.map((r) => (
              <li key={r.key} className="flex justify-between">
                <span>{r.label}</span>
                <span>{money(r.net_sales)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
