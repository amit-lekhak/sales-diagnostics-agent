import { addDays, format, parseISO } from 'date-fns';

export const DATA_START = '2025-03-01';
export const DATA_END = '2026-09-09';

export type DateRange = { from: string; to: string };

export function defaultRange(): DateRange {
  return { from: '2026-08-11', to: DATA_END };
}

export function parseRange(from?: string | null, to?: string | null): DateRange {
  const fallback = defaultRange();
  return {
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : fallback.from,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : fallback.to,
  };
}

export function priorPeriod(range: DateRange): DateRange {
  const from = parseISO(range.from);
  const to = parseISO(range.to);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, -(days - 1));
  return { from: format(priorFrom, 'yyyy-MM-dd'), to: format(priorTo, 'yyyy-MM-dd') };
}

export function yoyPeriod(range: DateRange): DateRange {
  const shift = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  return { from: shift(range.from), to: shift(range.to) };
}
