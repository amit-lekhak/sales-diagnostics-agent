import Link from 'next/link';

export function FilterBar({
  action,
  from,
  to,
  storeId,
  stores,
  status,
  extra,
}: {
  action: string;
  from: string;
  to: string;
  storeId?: string;
  stores?: { id: number; name: string }[];
  status?: string;
  extra?: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3"
    >
      <label className="text-xs text-[var(--muted)]">
        From
        <input
          type="date"
          name="from"
          defaultValue={from}
          className="mt-1 block rounded-md border border-[var(--line)] bg-white px-2 py-1 text-sm"
        />
      </label>
      <label className="text-xs text-[var(--muted)]">
        To
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="mt-1 block rounded-md border border-[var(--line)] bg-white px-2 py-1 text-sm"
        />
      </label>
      {stores && (
        <label className="text-xs text-[var(--muted)]">
          Store
          <select
            name="storeId"
            defaultValue={storeId ?? ''}
            className="mt-1 block rounded-md border border-[var(--line)] bg-white px-2 py-1 text-sm"
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
        <label className="text-xs text-[var(--muted)]">
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 block rounded-md border border-[var(--line)] bg-white px-2 py-1 text-sm"
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
        className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-white"
      >
        Apply
      </button>
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
  if (pages <= 1) return <p className="mt-3 text-sm text-[var(--muted)]">{total} rows</p>;
  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
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
