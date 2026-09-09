import { FilterBar, Pagination } from '@/components/dashboard/FilterBar';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { money } from '@/lib/format';
import { listStores, paginatedOrders } from '@/lib/queries';
import { qs, rangeFromSearch, spStr } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = rangeFromSearch(sp);
  const storeId = spStr(sp, 'storeId') ? Number(spStr(sp, 'storeId')) : undefined;
  const status = spStr(sp, 'status') ?? '';
  const page = Math.max(1, Number(spStr(sp, 'page') ?? 1));
  const stores = await listStores();
  const data = await paginatedOrders({
    range,
    storeId,
    status: status || undefined,
    page,
  });

  const hrefFor = (p: number) =>
    `/orders${qs({ from: range.from, to: range.to, storeId, status, page: p })}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Orders</h1>
      <div className="mt-6">
        <FilterBar
          action="/orders"
          from={range.from}
          to={range.to}
          storeId={storeId ? String(storeId) : ''}
          stores={stores}
          status={status}
        />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          title="No orders"
          body="Widen the date range or clear store/status filters."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-(--line) bg-(--panel)">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-(--line) text-xs uppercase text-(--muted)">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Store</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Subtotal</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-(--line)">
                  <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                  <td className="px-3 py-2">{r.store}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">{money(r.subtotal)}</td>
                  <td className="px-3 py-2">
                    {r.created_at.slice(0, 16).replace('T', ' ')}
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
