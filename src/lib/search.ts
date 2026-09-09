import { parseRange } from '@/lib/dates';

export function spStr(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function rangeFromSearch(sp: Record<string, string | string[] | undefined>) {
  return parseRange(spStr(sp, 'from'), spStr(sp, 'to'));
}

export function spPage(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): number {
  const n = Number(spStr(sp, key) ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function qs(params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}
