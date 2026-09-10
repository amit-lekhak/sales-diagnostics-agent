import Link from 'next/link';
import { lastMonth, lastQuarter } from '@/lib/dates';

export function FilterBar({
  action,
  from,
  to,
  storeId,
  stores,
  status,
  extra,
  preserve,
}: {
  action: string;
  from: string;
  to: string;
  storeId?: string;
  stores?: { id: number; name: string }[];
  status?: string;
  extra?: React.ReactNode;
  /** Extra query keys to keep on Last month / Last quarter preset links. */
  preserve?: Record<string, string | number | undefined | null>;
}) {
  const month = lastMonth();
  const quarter = lastQuarter();
  const presetQs = (range: { from: string; to: string }) => {
    const u = new URLSearchParams();
    u.set('from', range.from);
    u.set('to', range.to);
    if (storeId) u.set('storeId', storeId);
    if (status) u.set('status', status);
    for (const [k, v] of Object.entries(preserve ?? {})) {
      if (v != null && v !== '') u.set(k, String(v));
    }
    return `?${u.toString()}`;
  };
  return (
    <form
      action={action}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-(--line) bg-(--panel) p-3"
    >
      <label className="w-full text-xs text-(--muted) sm:w-auto">
        From
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="mt-1 block w-full rounded-md border border-(--line) bg-white px-2 py-1 text-sm"
        />
      </label>
      <label className="w-full text-xs text-(--muted) sm:w-auto">
        To
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="mt-1 block w-full rounded-md border border-(--line) bg-white px-2 py-1 text-sm"
        />
      </label>
      {stores && (
        <label className="w-full text-xs text-(--muted) sm:w-auto">
          Store
          <select
            name="storeId"
            defaultValue={storeId ?? ''}
            className="mt-1 block w-full rounded-md border border-(--line) bg-white px-2 py-1 text-sm"
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {status !== undefined && (
        <label className="w-full text-xs text-(--muted) sm:w-auto">
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 block w-full rounded-md border border-(--line) bg-white px-2 py-1 text-sm"
          >
            <option value="">All</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
      )}
      {extra}
      <button
        type="submit"
        className="w-full rounded-md bg-(--accent) px-3 py-2 text-sm text-white sm:w-auto"
      >
        Apply
      </button>
      <div className="flex w-full flex-wrap gap-2 text-[11px] sm:w-auto">
        <Link
          href={`${action}${presetQs(month)}`}
          className="rounded border border-(--line) bg-white px-2 py-1 text-stone-700"
        >
          Last month
        </Link>
        <Link
          href={`${action}${presetQs(quarter)}`}
          className="rounded border border-(--line) bg-white px-2 py-1 text-stone-700"
        >
          Last quarter
        </Link>
      </div>
    </form>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-sm text-(--muted)">{total} rows</p>;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-sm sm:gap-3">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="underline">
          Previous
        </Link>
      ) : (
        <span className="text-stone-400">Previous</span>
      )}
      <span>
        Page {page} of {pages} · {total} rows
      </span>
      {page < pages ? (
        <Link href={hrefFor(page + 1)} className="underline">
          Next
        </Link>
      ) : (
        <span className="text-stone-400">Next</span>
      )}
    </div>
  );
}
