import { Pagination } from '@/components/dashboard/FilterBar';
import { EmptyState } from '@/components/dashboard/EmptyState';
import { money } from '@/lib/format';
import { paginatedProducts } from '@/lib/queries';
import { qs, spStr } from '@/lib/search';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = spStr(sp, 'q') ?? '';
  const page = Math.max(1, Number(spStr(sp, 'page') ?? 1));
  const data = await paginatedProducts({ q, page });
  const hrefFor = (p: number) => `/products${qs({ q, page: p })}`;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Products</h1>
      <form action="/products" className="my-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or SKU"
          className="min-w-0 flex-1 rounded-md border border-(--line) bg-(--panel) px-3 py-2 text-sm"
        />
        <button className="shrink-0 rounded-md bg-(--accent) px-3 py-2 text-sm text-white">
          Search
        </button>
      </form>
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
                <th className="px-3 py-2">List price</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-(--line)">
                  <td className="px-3 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2">{money(r.unit_price)}</td>
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
