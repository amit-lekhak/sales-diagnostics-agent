import { money, num, pct } from '@/lib/format';

export function KpiCard({
  label,
  value,
  prior,
  format = 'money',
}: {
  label: string;
  value: number;
  prior?: number;
  format?: 'money' | 'number';
}) {
  const shown = format === 'money' ? money(value) : num(value);
  const delta = prior != null && prior !== 0 ? (value - prior) / prior : null;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{shown}</p>
      {delta != null && (
        <p className={`mt-1 text-sm ${delta >= 0 ? 'text-teal-700' : 'text-orange-800'}`}>
          {pct(delta)} vs prior period
        </p>
      )}
    </div>
  );
}
