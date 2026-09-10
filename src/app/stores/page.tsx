import { FilterBar, Pagination } from '@/components/dashboard/FilterBar';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { listRegions, paginatedStores } from '@/lib/queries';
import { qs, rangeFromSearch, spStr } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = rangeFromSearch(sp);
  const regionId = spStr(sp, 'regionId') ? Number(spStr(sp, 'regionId')) : undefined;
  const page = Math.max(1, Number(spStr(sp, 'page') ?? 1));
  const regions = await listRegions();
  const data = await paginatedStores({ page, regionId });
  const hrefFor = (p: number) =>
    `/stores${qs({ from: range.from, to: range.to, regionId, page: p })}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Stores</h1>
      <div className="mt-6">
        <FilterBar
          action="/stores"
          from={range.from}
          to={range.to}
          extra={
            <label className="w-full text-xs text-(--muted) sm:w-auto">
              Region
              <select
                name="regionId"
                defaultValue={regionId ? String(regionId) : ''}
                className="mt-1 block w-full rounded-md border border-(--line) bg-white px-2 py-1 text-sm"
              >
                <option value="">All regions</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          }
        />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="No stores" body="Clear the region filter." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-(--line) bg-(--panel)">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-(--line) text-xs uppercase text-(--muted)">
              <tr>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">Region</th>
                <th className="px-3 py-2">Lat / lon</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-(--line)">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.city}</td>
                  <td className="px-3 py-2">{r.region}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        hrefFor={hrefFor}
      />
    </div>
  );
}
