import { sql } from './db';
import type { DateRange } from './dates';

export async function listStores() {
  return sql<
    { id: number; name: string; city: string; region: string; region_id: number }[]
  >`
    SELECT s.id, s.name, s.city, r.name AS region, r.id AS region_id
    FROM stores s JOIN regions r ON r.id = s.region_id
    ORDER BY r.name, s.name
  `;
}

export async function listRegions() {
  return sql<{ id: number; name: string; code: string }[]>`
    SELECT id, name, code FROM regions ORDER BY name
  `;
}

export async function paginatedOrders(opts: {
  range: DateRange;
  storeId?: number;
  status?: string;
  page: number;
  pageSize?: number;
}) {
  const pageSize = opts.pageSize ?? 25;
  const offset = (opts.page - 1) * pageSize;
  const storeFilter =
    opts.storeId != null ? sql`AND o.store_id = ${opts.storeId}` : sql``;
  const statusFilter = opts.status ? sql`AND o.status = ${opts.status}` : sql``;

  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM orders o
    WHERE o.created_at::date >= ${opts.range.from}::date
      AND o.created_at::date <= ${opts.range.to}::date
      ${storeFilter}
      ${statusFilter}
  `;

  const rows = await sql<
    {
      id: number;
      store: string;
      status: string;
      subtotal: number;
      paid_at: string | null;
      created_at: string;
    }[]
  >`
    SELECT o.id, s.name AS store, o.status, o.subtotal,
           o.paid_at::text AS paid_at, o.created_at::text AS created_at
    FROM orders o
    JOIN stores s ON s.id = o.store_id
    WHERE o.created_at::date >= ${opts.range.from}::date
      AND o.created_at::date <= ${opts.range.to}::date
      ${storeFilter}
      ${statusFilter}
    ORDER BY o.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  return { rows, total: countRow?.count ?? 0, page: opts.page, pageSize };
}

export async function paginatedProducts(opts: {
  q?: string;
  page: number;
  pageSize?: number;
}) {
  const pageSize = opts.pageSize ?? 25;
  const offset = (opts.page - 1) * pageSize;
  const q = opts.q?.trim();
  const qFilter = q
    ? sql`AND (p.name ILIKE ${'%' + q + '%'} OR p.sku ILIKE ${'%' + q + '%'})`
    : sql``;
  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM products p WHERE 1=1 ${qFilter}
  `;
  const rows = await sql<
    { id: number; sku: string; name: string; category: string; unit_price: number }[]
  >`
    SELECT id, sku, name, category, unit_price
    FROM products p
    WHERE 1=1 ${qFilter}
    ORDER BY name
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return { rows, total: countRow?.count ?? 0, page: opts.page, pageSize };
}

export async function paginatedStores(opts: {
  page: number;
  pageSize?: number;
  regionId?: number;
}) {
  const pageSize = opts.pageSize ?? 25;
  const offset = (opts.page - 1) * pageSize;
  const regionFilter =
    opts.regionId != null ? sql`AND s.region_id = ${opts.regionId}` : sql``;
  const [countRow] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM stores s WHERE 1=1 ${regionFilter}
  `;
  const rows = await sql<
    {
      id: number;
      name: string;
      city: string;
      region: string;
      lat: number;
      lon: number;
    }[]
  >`
    SELECT s.id, s.name, s.city, r.name AS region, s.lat, s.lon
    FROM stores s JOIN regions r ON r.id = s.region_id
    WHERE 1=1 ${regionFilter}
    ORDER BY s.name
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return { rows, total: countRow?.count ?? 0, page: opts.page, pageSize };
}

export async function contextTables(
  range: DateRange,
  pages: { holidays: number; events: number; weather: number; news: number },
  pageSize = 25,
) {
  const holidayOffset = (pages.holidays - 1) * pageSize;
  const eventOffset = (pages.events - 1) * pageSize;
  const weatherOffset = (pages.weather - 1) * pageSize;
  const newsOffset = (pages.news - 1) * pageSize;

  const [holidayCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM holidays h
    WHERE h.date BETWEEN ${range.from}::date AND ${range.to}::date
  `;
  const holidays = await sql<{ date: string; name: string; region: string | null }[]>`
    SELECT h.date::text, h.name, r.name AS region
    FROM holidays h
    LEFT JOIN regions r ON r.id = h.region_id
    WHERE h.date BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY h.date DESC
    LIMIT ${pageSize} OFFSET ${holidayOffset}
  `;

  const [weatherCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM weather_daily w
    WHERE w.date BETWEEN ${range.from}::date AND ${range.to}::date
  `;
  const weather = await sql<
    {
      date: string;
      store: string;
      rain_mm: number;
      temp_c: number;
      conditions: string;
      source: string;
    }[]
  >`
    SELECT w.date::text, s.name AS store, w.rain_mm, w.temp_c, w.conditions, w.source
    FROM weather_daily w
    JOIN stores s ON s.id = w.store_id
    WHERE w.date BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY w.date DESC, s.name
    LIMIT ${pageSize} OFFSET ${weatherOffset}
  `;

  const [eventCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM company_events e
    WHERE e.starts_on <= ${range.to}::date AND e.ends_on >= ${range.from}::date
  `;
  const events = await sql<
    {
      starts_on: string;
      ends_on: string;
      type: string;
      notes: string;
      store: string | null;
    }[]
  >`
    SELECT e.starts_on::text, e.ends_on::text, e.type, e.notes, s.name AS store
    FROM company_events e
    LEFT JOIN stores s ON s.id = e.store_id
    WHERE e.starts_on <= ${range.to}::date AND e.ends_on >= ${range.from}::date
    ORDER BY e.starts_on DESC
    LIMIT ${pageSize} OFFSET ${eventOffset}
  `;

  const [newsCount] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM news_articles
    WHERE published_at::date BETWEEN ${range.from}::date AND ${range.to}::date
  `;
  const news = await sql<
    { published_at: string; source: string; title: string; body: string }[]
  >`
    SELECT published_at::text, source, title, body
    FROM news_articles
    WHERE published_at::date BETWEEN ${range.from}::date AND ${range.to}::date
    ORDER BY published_at DESC
    LIMIT ${pageSize} OFFSET ${newsOffset}
  `;

  return {
    holidays: {
      rows: holidays,
      total: holidayCount?.count ?? 0,
      page: pages.holidays,
      pageSize,
    },
    weather: {
      rows: weather,
      total: weatherCount?.count ?? 0,
      page: pages.weather,
      pageSize,
    },
    events: {
      rows: events,
      total: eventCount?.count ?? 0,
      page: pages.events,
      pageSize,
    },
    news: {
      rows: news,
      total: newsCount?.count ?? 0,
      page: pages.news,
      pageSize,
    },
  };
}

export async function opsSummary() {
  const [totals] = await sql<
    {
      runs: number;
      errors: number;
      avg_latency: number | null;
      p50: number | null;
      p95: number | null;
      tokens_in: number | null;
      tokens_out: number | null;
    }[]
  >`
    SELECT
      COUNT(*)::int AS runs,
      COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
      AVG(latency_ms)::float8 AS avg_latency,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::float8 AS p50,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::float8 AS p95,
      SUM(input_tokens)::int AS tokens_in,
      SUM(output_tokens)::int AS tokens_out
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '7 days'
  `;
  const recent = await sql<
    {
      id: string;
      created_at: string;
      model: string;
      status: string;
      latency_ms: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
      error: string | null;
      scope: string | null;
    }[]
  >`
    SELECT id::text, created_at::text, model, status, latency_ms, input_tokens, output_tokens, error, scope
    FROM agent_runs
    ORDER BY created_at DESC
    LIMIT 40
  `;
  const toolFails = await sql<{ name: string; fails: number }[]>`
    SELECT name, COUNT(*)::int AS fails
    FROM agent_spans
    WHERE error IS NOT NULL
    GROUP BY name
    ORDER BY fails DESC
    LIMIT 12
  `;
  const daily = await sql<{ day: string; runs: number; errors: number }[]>`
    SELECT created_at::date::text AS day,
           COUNT(*)::int AS runs,
           COUNT(*) FILTER (WHERE status = 'error')::int AS errors
    FROM agent_runs
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY created_at::date
    ORDER BY day
  `;
  return { totals, recent, toolFails, daily };
}

export async function runById(id: string) {
  const [row] = await sql<
    {
      id: string;
      created_at: string;
      model: string;
      status: string;
      latency_ms: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
      error: string | null;
      scope: string | null;
    }[]
  >`
    SELECT id::text, created_at::text, model, status, latency_ms, input_tokens, output_tokens, error, scope
    FROM agent_runs
    WHERE id = ${id}::uuid
  `;
  return row ?? null;
}

export async function runSpans(runId: string) {
  return sql<
    {
      id: string;
      parent_span_id: string | null;
      kind: string;
      name: string;
      started_at: string;
      ended_at: string | null;
      input: unknown;
      output: unknown;
      error: string | null;
      token_count: number | null;
    }[]
  >`
    SELECT id::text, parent_span_id::text, kind, name, started_at::text, ended_at::text,
           input, output, error, token_count
    FROM agent_spans
    WHERE run_id = ${runId}::uuid
    ORDER BY started_at
  `;
}
