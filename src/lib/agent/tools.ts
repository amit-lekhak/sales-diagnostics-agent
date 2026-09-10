import { sql } from '../db';
import {
  DATA_END,
  DATA_START,
  priorPeriod,
  rangeForPeriod,
  yoyPeriod,
  type DateRange,
  type NamedPeriod,
} from '../dates';
import { resolvePlace, resolveProduct } from '../dimensions';
import { money } from '../format';
import {
  breakdown,
  getMetric,
  METRIC_DEFS,
  type MetricFilters,
  type MetricName,
} from '../metrics';
import { addSpan } from './tracer';

export type ToolRuntime = {
  runId: string;
  scope: 'page' | 'all';
  filters: MetricFilters;
};

export type FilterOverride = Partial<MetricFilters> & {
  period?: NamedPeriod;
  storeName?: string;
  regionName?: string;
  productName?: string;
};

async function applyPage(
  rt: ToolRuntime,
  override?: FilterOverride,
): Promise<MetricFilters> {
  const named = rangeForPeriod(override?.period);
  const dates = named ?? {
    from: override?.from ?? rt.filters.from,
    to: override?.to ?? rt.filters.to,
  };
  const place = await resolvePlace({
    storeId: override?.storeId,
    regionId: override?.regionId,
    storeName: override?.storeName,
    regionName: override?.regionName,
  });
  const productId = await resolveProduct({
    productId: override?.productId,
    productName: override?.productName,
  });
  if (rt.scope === 'all') {
    return {
      ...dates,
      storeId: place.storeId,
      regionId: place.regionId,
      city: place.city ?? override?.city,
      productId,
    };
  }
  return {
    ...rt.filters,
    ...dates,
    storeId: place.storeId ?? rt.filters.storeId,
    regionId: place.regionId ?? rt.filters.regionId,
    city: place.city ?? override?.city ?? rt.filters.city,
    productId: productId ?? rt.filters.productId,
  };
}

export type LocationArgs = {
  storeId?: number;
  regionId?: number;
  storeName?: string;
  regionName?: string;
  productId?: number;
  productName?: string;
};

export type ToolFailure = { ok: false; error: string };

export function isToolFailure(value: unknown): value is ToolFailure {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

async function traced<T>(
  rt: ToolRuntime,
  name: string,
  input: unknown,
  fn: () => Promise<T>,
): Promise<T | ToolFailure> {
  const started = new Date();
  try {
    const out = await fn();
    await addSpan({
      runId: rt.runId,
      kind: 'tool',
      name,
      startedAt: started,
      payloadIn: input,
      payloadOut: out,
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await addSpan({
      runId: rt.runId,
      kind: 'tool',
      name,
      startedAt: started,
      payloadIn: input,
      error: message,
    });
    // Return to the model so the stream can continue; prompt says admit unknowns.
    return { ok: false, error: message };
  }
}

export function metricTools(rt: ToolRuntime) {
  return {
    async get_metric(
      args: {
        metric: MetricName;
        period?: NamedPeriod;
        from?: string;
        to?: string;
      } & LocationArgs,
    ) {
      const filters = await applyPage(rt, args);
      return traced(rt, 'get_metric', args, () => getMetric(args.metric, filters));
    },
    async breakdown(
      args: {
        dimension: 'region' | 'store' | 'sku';
        period?: NamedPeriod;
        from?: string;
        to?: string;
        limit?: number;
      } & LocationArgs,
    ) {
      const filters = await applyPage(rt, args);
      return traced(rt, 'breakdown', args, async () => ({
        dimension: args.dimension,
        rows: await breakdown(args.dimension, filters, args.limit ?? 8),
        filters,
      }));
    },
    async compare_periods(
      args: {
        metric: MetricName;
        period?: NamedPeriod;
        from?: string;
        to?: string;
        mode?: 'prior' | 'yoy';
      } & LocationArgs,
    ) {
      const current = await applyPage(rt, args);
      const other: DateRange =
        args.mode === 'yoy' ? yoyPeriod(current) : priorPeriod(current);
      return traced(rt, 'compare_periods', args, async () => {
        const a = await getMetric(args.metric, current);
        const b = await getMetric(args.metric, { ...current, ...other });
        const delta = a.value - b.value;
        const pct = b.value ? delta / b.value : null;
        const def = METRIC_DEFS[args.metric];
        return {
          metric: args.metric,
          label: def.label,
          current: { ...current, value: a.value, display: a.display },
          baseline: {
            ...other,
            value: b.value,
            display: b.display,
            mode: args.mode ?? 'prior',
          },
          delta,
          delta_display: money(delta),
          pct_change: pct,
        };
      });
    },
  };
}

export async function explainChange(
  rt: ToolRuntime,
  args: {
    period?: NamedPeriod;
    from?: string;
    to?: string;
    dimension?: 'region' | 'store' | 'sku';
  } & LocationArgs,
) {
  const current = await applyPage(rt, args);
  const prior = priorPeriod(current);
  const dimension = args.dimension ?? 'store';
  return traced(rt, 'explain_change', args, async () => {
    const [nowTotal, priorTotal, nowRows, priorRows] = await Promise.all([
      getMetric('net_sales', current),
      getMetric('net_sales', { ...current, ...prior }),
      breakdown(dimension, current, 20),
      breakdown(dimension, { ...current, ...prior }, 20),
    ]);
    const priorMap = new Map(priorRows.map((r) => [r.key, r.net_sales]));
    const contributions = nowRows
      .map((r) => {
        const prev = priorMap.get(r.key) ?? 0;
        const delta = r.net_sales - prev;
        return {
          key: r.key,
          label: r.label,
          current: r.net_sales,
          current_display: money(r.net_sales),
          prior: prev,
          prior_display: money(prev),
          delta,
          delta_display: money(delta),
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const explained = contributions.reduce((s, c) => s + c.delta, 0);
    const totalDelta = nowTotal.value - priorTotal.value;
    const remainder = totalDelta - explained;
    return {
      metric: 'net_sales',
      label: METRIC_DEFS.net_sales.label,
      current_period: current,
      prior_period: prior,
      current_value: nowTotal.value,
      current_display: nowTotal.display,
      prior_value: priorTotal.value,
      prior_display: priorTotal.display,
      delta: totalDelta,
      delta_display: money(totalDelta),
      dimension,
      top_contributors: contributions.slice(0, 8),
      explained_delta: explained,
      unexplained_remainder: remainder,
      unexplained_remainder_display: money(remainder),
      note: 'These are arithmetic contributions from slices, not proven causes.',
    };
  });
}

export async function listContextEvents(
  rt: ToolRuntime,
  args: {
    period?: NamedPeriod;
    from?: string;
    to?: string;
  } & LocationArgs,
) {
  const filters = await applyPage(rt, args);
  return traced(rt, 'list_context_events', args, async () => {
    // Resolve region from store/city when caller only passed those.
    let regionId = filters.regionId;
    if (regionId == null && filters.storeId != null) {
      const rows = await sql<{ region_id: number }[]>`
        SELECT region_id FROM stores WHERE id = ${filters.storeId} LIMIT 1
      `;
      regionId = rows[0]?.region_id;
    } else if (regionId == null && filters.city) {
      const rows = await sql<{ region_id: number }[]>`
        SELECT DISTINCT region_id FROM stores WHERE city ILIKE ${filters.city} LIMIT 2
      `;
      if (rows.length === 1) regionId = rows[0]!.region_id;
    }

    const eventScope =
      filters.storeId != null
        ? sql`AND (e.store_id IS NULL OR e.store_id = ${filters.storeId})`
        : filters.city
          ? sql`AND (e.store_id IS NULL OR s.city ILIKE ${filters.city})`
          : regionId != null
            ? sql`AND (e.store_id IS NULL OR s.region_id = ${regionId})`
            : sql``;

    const holidayScope =
      regionId != null
        ? sql`AND (h.region_id IS NULL OR h.region_id = ${regionId})`
        : sql``;

    const prior = priorPeriod(filters);
    const eventWindowFrom = prior.from < filters.from ? prior.from : filters.from;
    const events = await sql<
      {
        type: string;
        starts_on: string;
        ends_on: string;
        notes: string;
        store: string | null;
      }[]
    >`
      SELECT e.type, e.starts_on::text, e.ends_on::text, e.notes, s.name AS store
      FROM company_events e
      LEFT JOIN stores s ON s.id = e.store_id
      WHERE e.starts_on <= ${filters.to}::date AND e.ends_on >= ${eventWindowFrom}::date
      ${eventScope}
      ORDER BY e.starts_on
    `;
    const holidays = await sql<{ date: string; name: string; region: string | null }[]>`
      SELECT h.date::text, h.name, r.name AS region
      FROM holidays h
      LEFT JOIN regions r ON r.id = h.region_id
      WHERE h.date BETWEEN ${filters.from}::date AND ${filters.to}::date
      ${holidayScope}
    `;
    const promoRegionFilter =
      regionId != null
        ? sql`AND (p.region_id IS NULL OR p.region_id = ${regionId})`
        : sql``;
    const promoProductFilter =
      filters.productId != null
        ? sql`AND (p.product_id IS NULL OR p.product_id = ${filters.productId})`
        : sql``;
    const promotions = await sql<
      {
        name: string;
        starts_on: string;
        ends_on: string;
        region: string | null;
        product: string | null;
      }[]
    >`
      SELECT p.name, p.starts_on::text, p.ends_on::text,
             r.name AS region, pr.name AS product
      FROM promotions p
      LEFT JOIN regions r ON r.id = p.region_id
      LEFT JOIN products pr ON pr.id = p.product_id
      WHERE p.starts_on <= ${filters.to}::date
        AND p.ends_on >= ${eventWindowFrom}::date
        ${promoRegionFilter}
        ${promoProductFilter}
      ORDER BY p.starts_on
    `;
    const weatherJoin =
      filters.storeId != null
        ? sql`AND w.store_id = ${filters.storeId}`
        : regionId != null
          ? sql`AND s.region_id = ${regionId}`
          : filters.city
            ? sql`AND s.city ILIKE ${filters.city}`
            : sql``;
    const weather = await sql<
      { store: string; rain_mm: number; temp_c: number; wet_days: number }[]
    >`
      SELECT s.name AS store,
             AVG(w.rain_mm)::float8 AS rain_mm,
             AVG(w.temp_c)::float8 AS temp_c,
             COUNT(*) FILTER (WHERE w.rain_mm >= 10)::int AS wet_days
      FROM weather_daily w
      JOIN stores s ON s.id = w.store_id
      WHERE w.date BETWEEN ${filters.from}::date AND ${filters.to}::date
      ${weatherJoin}
      GROUP BY s.name
      ORDER BY rain_mm DESC
    `;
    return {
      filters,
      holidays,
      company_events: events,
      promotions,
      weather_by_store: weather,
      interpretation:
        'Overlap is a correlation. Do not claim weather or news caused a sales move unless a company_event also matches. Events that ended just before this window (for example a promo) are included because they can explain a drop after the end date.',
    };
  });
}

export async function searchNews(
  rt: ToolRuntime,
  args: { query: string; period?: NamedPeriod; from?: string; to?: string },
) {
  const hasWindow = Boolean(args.period || args.from || args.to);
  const filters = hasWindow
    ? await applyPage(rt, args)
    : { from: DATA_START, to: DATA_END };
  return traced(rt, 'search_news', args, async () => {
    const { embedTexts, toVectorLiteral } = await import('../embeddings');
    const started = new Date();
    const { vectors, provider } = await embedTexts([args.query]);
    await addSpan({
      runId: rt.runId,
      kind: 'embed',
      name: `embed:${provider}`,
      startedAt: started,
      payloadIn: { query: args.query },
      payloadOut: { dim: vectors[0]?.length ?? 0 },
    });
    const vec = toVectorLiteral(vectors[0]!);
    const rows = await sql<
      {
        title: string;
        body: string;
        source: string;
        published_at: string;
        distance: number;
      }[]
    >`
      SELECT a.title, a.body, a.source, a.published_at::text,
             (c.embedding <=> ${vec}::vector)::float8 AS distance
      FROM news_chunks c
      JOIN news_articles a ON a.id = c.article_id
      WHERE (c.date_from IS NULL OR c.date_to >= ${filters.from}::date)
        AND (c.date_to IS NULL OR c.date_from <= ${filters.to}::date)
      ORDER BY c.embedding <=> ${vec}::vector
      LIMIT 5
    `;
    return {
      provider,
      matches: rows,
      note: 'Semantic overlap only. Not a causal claim.',
    };
  });
}
