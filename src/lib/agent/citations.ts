import { money } from '../format';

export type TraceSpan = {
  kind: string;
  name: string;
  error: string | null;
  output: unknown;
};

const METRIC_LABELS: Record<string, string> = {
  net_sales: 'Net sales',
  units: 'Units',
  aov: 'Average order value',
};

/** Tool names that produce analyst-facing evidence (SQL / news / context). */
const EVIDENCE_TOOLS = new Set([
  'get_metric',
  'breakdown',
  'compare_periods',
  'explain_change',
  'list_context_events',
  'search_news',
]);

/**
 * Build analyst-facing citation lines from run spans.
 * Only successful tool evidence is included — guard/llm/error spans stay on Trace / ops.
 */
export function citationsFromSpans(spans: TraceSpan[]): string[] {
  const lines: string[] = [];
  for (const span of spans) {
    if (span.error) continue;
    if (!EVIDENCE_TOOLS.has(span.name)) continue;

    const out = asRecord(span.output);
    if (!out) continue;

    if (span.name === 'get_metric' && out.metric != null) {
      const label = metricLabel(out);
      const shown = typeof out.display === 'string' ? out.display : fmtMoney(out.value);
      lines.push(`SQL ${label} = ${shown} (${fmtFilters(out.filters)})`);
    } else if (span.name === 'breakdown') {
      const rows = Array.isArray(out.rows) ? out.rows : [];
      const top = rows
        .slice(0, 3)
        .map((r) => {
          const rec = asRecord(r);
          return rec ? `${String(rec.label)} ${fmtMoney(rec.net_sales)}` : '';
        })
        .filter(Boolean)
        .join('; ');
      lines.push(
        `SQL breakdown by ${String(out.dimension ?? 'slice')}: ${top || 'no rows'}`,
      );
    } else if (span.name === 'compare_periods') {
      const label = metricLabel(out);
      const shown =
        typeof out.delta_display === 'string' ? out.delta_display : fmtMoney(out.delta);
      lines.push(
        `SQL compare ${label} delta ${shown} (${fmtFilters(asRecord(out.current))})`,
      );
    } else if (span.name === 'explain_change') {
      const shown =
        typeof out.delta_display === 'string' ? out.delta_display : fmtMoney(out.delta);
      lines.push(
        `SQL explain_change delta ${shown}; unexplained remainder ${fmtMoney(out.unexplained_remainder)}`,
      );
    } else if (span.name === 'list_context_events') {
      const holidays = Array.isArray(out.holidays) ? out.holidays.length : 0;
      const events = Array.isArray(out.company_events) ? out.company_events.length : 0;
      const promos = Array.isArray(out.promotions) ? out.promotions.length : 0;
      const weather = Array.isArray(out.weather_by_store)
        ? out.weather_by_store.length
        : 0;
      lines.push(
        `Stored context: ${holidays} holidays, ${events} company events, ${promos} promotions, ${weather} weather store rows (correlation, not cause)`,
      );
    } else if (span.name === 'search_news') {
      const matches = Array.isArray(out.matches) ? out.matches : [];
      const titles = matches
        .slice(0, 3)
        .map((m) => asRecord(m)?.title)
        .filter(Boolean)
        .join('; ');
      lines.push(`News (pgvector): ${titles || 'no matches'}`);
    }
  }
  return lines;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function metricLabel(out: Record<string, unknown>): string {
  if (typeof out.label === 'string' && out.label) return out.label;
  const key = String(out.metric ?? '');
  return (METRIC_LABELS[key] ?? key) || 'metric';
}

function fmtMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '—');
  return money(n);
}

function fmtFilters(value: unknown): string {
  const rec = asRecord(value);
  if (!rec) return 'default page filters';
  const bits = [rec.from, rec.to, rec.storeId, rec.regionId].filter(
    (v) => v != null && v !== '',
  );
  return bits.length ? bits.map(String).join(' · ') : 'unfiltered';
}
