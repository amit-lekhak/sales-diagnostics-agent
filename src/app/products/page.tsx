import Link from 'next/link';
import { FilterBar, Pagination } from '@/components/dashboard/FilterBar';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { money, num } from '@/lib/format';
import { breakdown } from '@/lib/metrics';
import { paginatedProducts } from '@/lib/queries';
import { qs, rangeFromSearch, spStr } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = rangeFromSearch(sp);
  const q = spStr(sp, 'q') ?? '';
  const page = Math.max(1, Number(spStr(sp, 'page') ?? 1));
  const data = await paginatedProducts({ q, page });
  const salesRows = await breakdown('sku', range, 500);
  const salesById = new Map(salesRows.map((r) => [Number(r.key), r]));
  const hrefFor = (p: number) =>
    `/products${qs({ from: range.from, to: range.to, q, page: p })}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Products</h1>
      <div className="mt-6">
        <FilterBar
          action="/products"
          from={range.from}
          to={range.to}
          preserve={{ q }}
          extra={
            <label className="w-full min-w-48 flex-1 text-xs text-(--muted)">
              Search
              <input
                name="q"
                defaultValue={q}
                placeholder="Name or SKU"
                className="mt-1 block w-full rounded-md border border-(--line) bg-white px-2 py-1 text-sm"
              />
            </label>
          }
        />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState title="No products" body="Try a different search." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-(--line) bg-(--panel)">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-(--line) text-xs uppercase text-(--muted)">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">List price</th>
                <th className="px-3 py-2 text-right">Net sales</th>
                <th className="px-3 py-2 text-right">Units</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const sales = salesById.get(r.id);
                return (
                  <tr key={r.id} className="border-t border-(--line)">
                    <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                    <td className="px-3 py-2">
                      <Link
                        className="underline"
                        href={`/products${qs({
                          from: range.from,
                          to: range.to,
                          q,
                          productId: r.id,
                        })}`}
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{r.category}</td>
                    <td className="px-3 py-2 text-right">{money(r.unit_price)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {sales ? money(sales.net_sales) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {sales ? num(sales.units) : '—'}
                    </td>
                  </tr>
                );
              })}
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
