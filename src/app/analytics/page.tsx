import {
  BreakdownChart,
  VolumeSalesChart,
  WaterfallChart,
} from '@/components/dashboard/BreakdownChart';
import { FilterBar } from '@/components/dashboard/FilterBar';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { priorPeriod } from '@/lib/dates';
import { money, pct } from '@/lib/format';
import { breakdown, kpiBundle, seriesByDay } from '@/lib/metrics';
import { listStores } from '@/lib/queries';
import { rangeFromSearch, spStr } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
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
  const [now, before, series, byRegion, byStore, bySku, priorStores] = await Promise.all([
    kpiBundle(filters),
    kpiBundle({ ...prior, storeId }),
    seriesByDay(filters),
    breakdown('region', filters, 8),
    breakdown('store', filters, 8),
    breakdown('sku', filters, 8),
    breakdown('store', { ...prior, storeId }, 8),
  ]);
  const delta = before.net_sales
    ? (now.net_sales - before.net_sales) / before.net_sales
    : 0;
  const priorMap = new Map(priorStores.map((r) => [r.key, r.net_sales]));
  const waterfall = byStore.map((r) => ({
    label: r.label.replace('Northstar ', ''),
    delta: r.net_sales - (priorMap.get(r.key) ?? 0),
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-(--muted)">
        Period vs prior period of the same length. {pct(delta)} net sales.
      </p>
      <div className="mt-6">
        <FilterBar
          action="/analytics"
          from={range.from}
          to={range.to}
          storeId={storeId ? String(storeId) : ''}
          stores={stores}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiCard label="Net sales" value={now.net_sales} prior={before.net_sales} />
        <KpiCard label="Units" value={now.units} prior={before.units} format="number" />
        <KpiCard label="AOV" value={now.aov} prior={before.aov} />
      </div>
      <section className="mt-6 rounded-xl border border-(--line) bg-(--panel) p-4">
        <h2 className="mb-3 text-sm font-medium">Volume vs net sales</h2>
        <VolumeSalesChart data={series} />
      </section>
      <section className="mt-6 rounded-xl border border-(--line) bg-(--panel) p-4">
        <h2 className="mb-3 text-sm font-medium">Store contribution to period change</h2>
        <WaterfallChart data={waterfall} />
      </section>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-(--line) bg-(--panel) p-4">
          <h2 className="mb-3 text-sm font-medium">By region</h2>
          <BreakdownChart data={byRegion} />
          <ul className="mt-2 space-y-2 text-sm">
            {byRegion.map((r) => (
              <li key={r.key} className="flex justify-between">
                <span>{r.label}</span>
                <span>{money(r.net_sales)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl border border-(--line) bg-(--panel) p-4">
          <h2 className="mb-3 text-sm font-medium">By store</h2>
          <BreakdownChart data={byStore} />
        </section>
        <section className="rounded-xl border border-(--line) bg-(--panel) p-4 md:col-span-2">
          <h2 className="mb-3 text-sm font-medium">By SKU</h2>
          <BreakdownChart data={bySku} />
        </section>
      </div>
    </div>
  );
}
