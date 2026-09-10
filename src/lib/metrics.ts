import { sql } from './db';
import type { DateRange } from './dates';
import { money, num } from './format';

export const METRIC_DEFS = {
  net_sales: {
    name: 'net_sales',
    label: 'Net sales',
    description:
      'SUM(store_day_metrics.net_sales) in integer paise for paid retail orders, rolled up daily.',
  },
  units: {
    name: 'units',
    label: 'Units',
    description: 'SUM(store_day_metrics.units).',
  },
  aov: {
    name: 'aov',
    label: 'Average order value',
    description:
      'SUM(net_sales) / NULLIF(SUM(order_count), 0), rounded to integer paise.',
  },
} as const;

export type MetricName = keyof typeof METRIC_DEFS;

export type MetricFilters = DateRange & {
  storeId?: number;
  regionId?: number;
  productId?: number;
  city?: string;
};

function needsStoreJoin(filters: MetricFilters) {
  return filters.regionId != null || Boolean(filters.city);
}

function cityClause(filters: MetricFilters) {
  return filters.city ? sql`AND s.city ILIKE ${filters.city}` : sql``;
}

export async function getMetric(name: MetricName, filters: MetricFilters) {
  const storeJoin = needsStoreJoin(filters)
    ? sql`JOIN stores s ON s.id = m.store_id`
    : sql``;
  const storeFilter =
    filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
  const regionFilter =
    filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;
  const cityFilter = cityClause(filters);

  const expr =
    name === 'net_sales'
      ? sql`COALESCE(SUM(m.net_sales), 0)::bigint`
      : name === 'units'
        ? sql`COALESCE(SUM(m.units), 0)::bigint`
        : sql`COALESCE(ROUND(SUM(m.net_sales)::numeric / NULLIF(SUM(m.order_count), 0)), 0)::bigint`;

  const row = await sql<{ value: number | null }[]>`
    SELECT ${expr} AS value
    FROM store_day_metrics m
    ${storeJoin}
    WHERE m.day >= ${filters.from}::date
      AND m.day <= ${filters.to}::date
      ${storeFilter}
      ${regionFilter}
      ${cityFilter}
  `;

  const value = Math.round(Number(row[0]?.value ?? 0));
  return {
    metric: name,
    ...METRIC_DEFS[name],
    value,
    unit: name === 'units' ? 'count' : 'paise',
    display: name === 'units' ? num(value) : money(value),
    filters,
  };
}

function asInt(n: number | string | bigint | null | undefined): number {
  if (typeof n === 'bigint') return Number(n);
  return Math.round(Number(n ?? 0));
}

export async function seriesByDay(filters: MetricFilters) {
  const storeJoin = needsStoreJoin(filters)
    ? sql`JOIN stores s ON s.id = m.store_id`
    : sql``;
  const storeFilter =
    filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
  const regionFilter =
    filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;
  const cityFilter = cityClause(filters);

  const rows = await sql<
    { day: string; net_sales: number; units: number; order_count: number }[]
  >`
    SELECT m.day::text AS day,
           SUM(m.net_sales)::bigint AS net_sales,
           SUM(m.units)::int AS units,
           SUM(m.order_count)::int AS order_count
    FROM store_day_metrics m
    ${storeJoin}
    WHERE m.day >= ${filters.from}::date
      AND m.day <= ${filters.to}::date
      ${storeFilter}
      ${regionFilter}
      ${cityFilter}
    GROUP BY m.day
    ORDER BY m.day
  `;
  return rows.map((r) => ({
    ...r,
    net_sales: asInt(r.net_sales),
    units: asInt(r.units),
    order_count: asInt(r.order_count),
  }));
}

export async function breakdown(
  dimension: 'region' | 'store' | 'sku',
  filters: MetricFilters,
  limit = 12,
) {
  if (dimension === 'sku') {
    const storeFilter =
      filters.storeId != null ? sql`AND o.store_id = ${filters.storeId}` : sql``;
    const regionJoin = needsStoreJoin(filters)
      ? sql`JOIN stores s ON s.id = o.store_id`
      : sql``;
    const regionFilter =
      filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;
    const cityFilter = cityClause(filters);
    const productFilter =
      filters.productId != null ? sql`AND oi.product_id = ${filters.productId}` : sql``;
    const rows = await sql<
      { key: string; label: string; net_sales: number; units: number }[]
    >`
      SELECT p.id::text AS key, p.name AS label,
             SUM(oi.line_total)::bigint AS net_sales,
             SUM(oi.qty)::int AS units
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
      ${regionJoin}
      WHERE o.status = 'paid'
        AND o.paid_at::date >= ${filters.from}::date
        AND o.paid_at::date <= ${filters.to}::date
        ${storeFilter}
        ${regionFilter}
        ${cityFilter}
        ${productFilter}
      GROUP BY p.id, p.name
      ORDER BY net_sales DESC
      LIMIT ${limit}
    `;
    return intMoneyRows(rows);
  }

  if (dimension === 'store') {
    const storeFilter =
      filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
    const regionFilter =
      filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;
    const cityFilter = cityClause(filters);
    const rows = await sql<
      { key: string; label: string; net_sales: number; units: number }[]
    >`
      SELECT s.id::text AS key, s.name AS label,
             SUM(m.net_sales)::bigint AS net_sales,
             SUM(m.units)::int AS units
      FROM store_day_metrics m
      JOIN stores s ON s.id = m.store_id
      WHERE m.day >= ${filters.from}::date
        AND m.day <= ${filters.to}::date
        ${storeFilter}
        ${regionFilter}
        ${cityFilter}
      GROUP BY s.id, s.name
      ORDER BY net_sales DESC
      LIMIT ${limit}
    `;
    return intMoneyRows(rows);
  }

  const storeFilter =
    filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
  const regionFilter =
    filters.regionId != null ? sql`AND r.id = ${filters.regionId}` : sql``;
  const cityFilter = cityClause(filters);
  const rows = await sql<
    { key: string; label: string; net_sales: number; units: number }[]
  >`
    SELECT r.id::text AS key, r.name AS label,
           SUM(m.net_sales)::bigint AS net_sales,
           SUM(m.units)::int AS units
    FROM store_day_metrics m
    JOIN stores s ON s.id = m.store_id
    JOIN regions r ON r.id = s.region_id
    WHERE m.day >= ${filters.from}::date
      AND m.day <= ${filters.to}::date
      ${storeFilter}
      ${regionFilter}
      ${cityFilter}
    GROUP BY r.id, r.name
    ORDER BY net_sales DESC
    LIMIT ${limit}
  `;
  return intMoneyRows(rows);
}

function intMoneyRows(
  rows: { key: string; label: string; net_sales: number; units: number }[],
) {
  return rows.map((r) => {
    const net_sales = asInt(r.net_sales);
    const units = asInt(r.units);
    return {
      ...r,
      net_sales,
      units,
      display: money(net_sales),
      units_display: num(units),
    };
  });
}

export async function kpiBundle(filters: MetricFilters) {
  const [net, units, aov] = await Promise.all([
    getMetric('net_sales', filters),
    getMetric('units', filters),
    getMetric('aov', filters),
  ]);
  return { net_sales: net.value, units: units.value, aov: aov.value };
}
