import { format, isSameDay } from 'date-fns';

export function money(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function moneyAxisTick(paise: number): string {
  return `${Math.round(paise / 100 / 1000)}k`;
}

export function num(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

export function pct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

export function shortDate(iso: string): string {
  try {
    return format(new Date(`${iso}T00:00:00`), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return format(d, 'd MMM yyyy, h:mm:ss a');
}

function durationLabel(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

/** Human-friendly latency for ops KPIs and tables. */
export function latency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return durationLabel(ms);
}

export function spanRange(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return startedAt;
  if (!endedAt) return `${format(start, 'h:mm:ss a')} → open`;
  const end = new Date(endedAt);
  if (Number.isNaN(end.getTime())) {
    return `${format(start, 'h:mm:ss a')} → ${endedAt}`;
  }
  const startStr = isSameDay(start, end)
    ? format(start, 'h:mm:ss a')
    : format(start, 'd MMM, h:mm:ss a');
  const endStr = isSameDay(start, end)
    ? format(end, 'h:mm:ss a')
    : format(end, 'd MMM, h:mm:ss a');
  return `${startStr} → ${endStr} (${durationLabel(end.getTime() - start.getTime())})`;
}
