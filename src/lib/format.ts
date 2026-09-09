import { format } from 'date-fns';

export function money(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
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
