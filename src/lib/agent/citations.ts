export type TraceSpan = {
  kind: string;
  name: string;
  error: string | null;
  output: unknown;
};

export function citationsFromSpans(spans: TraceSpan[]): string[] {
  const lines: string[] = [];
  for (const span of spans) {
    if (span.error) {
      lines.push(`${span.name} failed: ${span.error}`);
      continue;
    }
    const out = asRecord(span.output);
    if (!out) {
      if (span.kind === 'llm' || span.kind === 'summarize' || span.kind === 'embed') {
        lines.push(`${span.kind}: ${span.name}`);
      }
      continue;
    }
    if (span.name === 'get_metric' && out.metric != null) {
      lines.push(
        `SQL metric ${String(out.metric)} = ${fmtNum(out.value)} (${fmtFilters(out.filters)})`,
      );
    } else if (span.name === 'breakdown') {
      const rows = Array.isArray(out.rows) ? out.rows : [];
      const top = rows
        .slice(0, 3)
        .map((r) => {
          const rec = asRecord(r);
          return rec ? `${String(rec.label)} ${fmtNum(rec.net_sales)}` : '';
        })
        .filter(Boolean)
        .join('; ');
      lines.push(
        `SQL breakdown by ${String(out.dimension ?? 'slice')}: ${top || 'no rows'}`,
      );
    } else if (span.name === 'compare_periods') {
      lines.push(
        `SQL compare ${String(out.metric)} delta ${fmtNum(out.delta)} (${fmtFilters(asRecord(out.current))})`,
      );
    } else if (span.name === 'explain_change') {
      lines.push(
        `SQL explain_change delta ${fmtNum(out.delta)}; unexplained remainder ${fmtNum(out.unexplained_remainder)}`,
      );
    } else if (span.name === 'list_context_events') {
      const holidays = Array.isArray(out.holidays) ? out.holidays.length : 0;
      const events = Array.isArray(out.company_events) ? out.company_events.length : 0;
      const weather = Array.isArray(out.weather_by_store)
        ? out.weather_by_store.length
        : 0;
      lines.push(
        `Stored context: ${holidays} holidays, ${events} company events, ${weather} weather store rows (correlation, not cause)`,
      );
    } else if (span.name === 'search_news') {
      const matches = Array.isArray(out.matches) ? out.matches : [];
      const titles = matches
        .slice(0, 3)
        .map((m) => asRecord(m)?.title)
        .filter(Boolean)
        .join('; ');
      lines.push(`News (pgvector): ${titles || 'no matches'}`);
    } else {
      lines.push(`${span.kind}/${span.name}`);
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

function fmtNum(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '—');
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);
}

function fmtFilters(value: unknown): string {
  const rec = asRecord(value);
  if (!rec) return 'default page filters';
  const bits = [rec.from, rec.to, rec.storeId, rec.regionId].filter(
    (v) => v != null && v !== '',
  );
  return bits.length ? bits.map(String).join(' · ') : 'unfiltered';
}
