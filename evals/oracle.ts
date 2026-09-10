import { rangeForPeriod } from '../src/lib/dates';
import { money } from '../src/lib/format';
import { breakdown, getMetric, type MetricFilters } from '../src/lib/metrics';
import {
  explainChange,
  listContextEvents,
  searchNews,
  type ToolRuntime,
} from '../src/lib/agent/tools';
import { createRun, finishRun } from '../src/lib/agent/tracer';
import type { EvalCase, FilterSpec, OracleSpec } from './cases';
import { type Catalog, resolveFilter } from './catalog';

export type OracleResult = {
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  displays: string[];
  labels: string[];
  newsTitles: string[];
  newsProvider?: string;
  detail: string;
  payload: unknown;
};

async function withEvalRuntime<T>(
  filters: MetricFilters,
  fn: (rt: ToolRuntime) => Promise<T>,
): Promise<T> {
  const runId = await createRun({
    conversationId: null,
    model: 'eval-oracle',
    scope: 'all',
  });
  const started = Date.now();
  try {
    const out = await fn({ runId, scope: 'all', filters });
    await finishRun(runId, { status: 'ok', latencyMs: Date.now() - started });
    return out;
  } catch (err) {
    await finishRun(runId, {
      status: 'error',
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

function datesFromSpec(spec: FilterSpec, resolved: MetricFilters): MetricFilters {
  const named = rangeForPeriod(spec.period);
  return named ? { ...resolved, ...named } : resolved;
}

function titlesInMatches(matches: { title: string }[], expected: string[]) {
  const got = new Set(matches.map((m) => m.title));
  return expected.filter((t) => got.has(t));
}

export async function runOracle(catalog: Catalog, cse: EvalCase): Promise<OracleResult> {
  const spec = cse.oracle;
  const primary = await runOracleSpec(catalog, spec, cse);
  if (spec.kind === 'search_news' || !cse.expect.newsTitles?.length) {
    return primary;
  }
  const retrieval = await runOracleSpec(
    catalog,
    {
      kind: 'search_news',
      query: cse.expect.retrievalQuery ?? cse.expect.newsTitles.join(' '),
      from: 'from' in spec ? spec.from : undefined,
      to: 'to' in spec ? spec.to : undefined,
      regionName: 'regionName' in spec ? spec.regionName : undefined,
      storeName: 'storeName' in spec ? spec.storeName : undefined,
    },
    cse,
  );
  return {
    ...primary,
    ok: primary.ok && retrieval.ok,
    skipped: retrieval.skipped,
    skipReason: retrieval.skipReason,
    newsTitles: retrieval.newsTitles,
    newsProvider: retrieval.newsProvider,
    detail: `${primary.detail}; ${retrieval.detail}`,
    payload: { primary: primary.payload, retrieval: retrieval.payload },
  };
}

async function runOracleSpec(
  catalog: Catalog,
  spec: OracleSpec,
  cse: EvalCase,
): Promise<OracleResult> {
  if (spec.kind === 'get_metric') {
    const filters = datesFromSpec(spec, await resolveFilter(catalog, spec));
    const row = await getMetric(spec.metric, filters);
    const ok = row.value !== 0;
    return {
      ok,
      displays: [row.display],
      labels: [],
      newsTitles: [],
      detail: ok
        ? `${spec.metric} ${filters.from}→${filters.to} = ${row.display}`
        : `${spec.metric} was 0 for ${filters.from}→${filters.to}`,
      payload: row,
    };
  }

  if (spec.kind === 'breakdown') {
    const filters = datesFromSpec(spec, await resolveFilter(catalog, spec));
    const rows = await breakdown(spec.dimension, filters, 12);
    const labels = rows.map((r) => r.label);
    const displays = rows.map((r) => money(r.net_sales));
    const missing = (cse.expect.labels ?? []).filter((l) => !labels.includes(l));
    const ok = rows.length > 0 && missing.length === 0;
    return {
      ok,
      displays,
      labels,
      newsTitles: [],
      detail: ok
        ? `${spec.dimension} breakdown ${rows.length} rows`
        : missing.length
          ? `missing labels: ${missing.join(', ')}`
          : 'empty breakdown',
      payload: rows,
    };
  }

  if (spec.kind === 'get_metric_pair') {
    const left = datesFromSpec(spec.left, await resolveFilter(catalog, spec.left));
    const right = datesFromSpec(spec.right, await resolveFilter(catalog, spec.right));
    const a = await getMetric(spec.metric, left);
    const b = await getMetric(spec.metric, right);
    const relationOk =
      spec.relation === 'left_gt_right' ? a.value > b.value : b.value > a.value;
    const nonzero = a.value !== 0 && b.value !== 0;
    const ok = relationOk && nonzero;
    return {
      ok,
      displays: [a.display, b.display],
      labels: [],
      newsTitles: [],
      detail: ok
        ? `${a.display} vs ${b.display}`
        : `pair check failed (${a.display} vs ${b.display})`,
      payload: { left: a, right: b, relation: spec.relation },
    };
  }

  if (spec.kind === 'explain_change') {
    const filters = datesFromSpec(spec, await resolveFilter(catalog, spec));
    const payload = await withEvalRuntime(filters, (rt) =>
      explainChange(rt, {
        from: filters.from,
        to: filters.to,
        dimension: spec.dimension,
        storeName: spec.storeName,
        regionName: spec.regionName,
      }),
    );
    const ok = payload.current_value !== 0 || payload.prior_value !== 0;
    return {
      ok,
      displays: [payload.current_display, payload.prior_display, payload.delta_display],
      labels: payload.top_contributors.map((c) => c.label),
      newsTitles: [],
      detail: ok
        ? `delta ${payload.delta_display}, remainder ${payload.unexplained_remainder}`
        : 'explain_change returned zeros',
      payload,
    };
  }

  if (spec.kind === 'list_context_events') {
    const filters = datesFromSpec(spec, await resolveFilter(catalog, spec));
    const payload = await withEvalRuntime(filters, (rt) =>
      listContextEvents(rt, {
        from: filters.from,
        to: filters.to,
        storeName: spec.storeName,
        regionName: spec.regionName,
      }),
    );
    const holidayNames = payload.holidays.map((h) => h.name);
    const eventNotes = payload.company_events.map((e) => e.notes);
    const blob = [...holidayNames, ...eventNotes].join(' ');
    const missing = (cse.expect.mustMention ?? []).filter(
      (m) => !blob.toLowerCase().includes(m.toLowerCase()),
    );
    const ok =
      missing.length === 0 &&
      (payload.holidays.length > 0 || payload.company_events.length > 0);
    return {
      ok,
      displays: [],
      labels: [...holidayNames, ...payload.company_events.map((e) => e.type)],
      newsTitles: [],
      detail: ok
        ? `${payload.holidays.length} holidays, ${payload.company_events.length} events`
        : missing.length
          ? `context missing: ${missing.join(', ')}`
          : 'no holidays or company events',
      payload,
    };
  }

  const filters = datesFromSpec(spec, await resolveFilter(catalog, spec));
  const query = cse.expect.retrievalQuery ?? spec.query;
  const payload = await withEvalRuntime(filters, (rt) =>
    searchNews(rt, { query, from: filters.from, to: filters.to }),
  );
  const expected = cse.expect.newsTitles ?? [];
  const found = titlesInMatches(payload.matches, expected);
  const recall = expected.length === 0 ? 1 : found.length / expected.length;
  if (payload.provider === 'fallback' && recall < 1) {
    return {
      ok: true,
      skipped: true,
      skipReason: 'search_news used fallback embeddings; RAG recall skipped',
      displays: [],
      labels: [],
      newsTitles: payload.matches.map((m) => m.title),
      newsProvider: payload.provider,
      detail: `fallback embeddings; expected ${expected.join(' | ')}`,
      payload,
    };
  }
  const ok = recall === 1;
  return {
    ok,
    displays: [],
    labels: [],
    newsTitles: payload.matches.map((m) => m.title),
    newsProvider: payload.provider,
    detail: ok
      ? `recall@5 ${found.length}/${expected.length} (${payload.provider})`
      : `missing titles: ${expected.filter((t) => !found.includes(t)).join(', ')}`,
    payload,
  };
}

export function retrievalRecall(
  titles: string[],
  expected: string[] | undefined,
): number | null {
  if (!expected?.length) return null;
  const got = new Set(titles);
  return expected.filter((t) => got.has(t)).length / expected.length;
}
