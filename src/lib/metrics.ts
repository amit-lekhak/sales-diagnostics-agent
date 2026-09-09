import { sql } from './db';
import type { DateRange } from './dates';

export const METRIC_DEFS = {
  net_sales: {
    name: 'net_sales',
    label: 'Net sales',
    description:
      'SUM(store_day_metrics.net_sales) for paid retail orders, rolled up daily.',
  },
  units: {
    name: 'units',
    label: 'Units',
    description: 'SUM(store_day_metrics.units).',
  },
  aov: {
    name: 'aov',
    label: 'Average order value',
    description: 'SUM(net_sales) / NULLIF(SUM(order_count), 0).',
  },
} as const;

export type MetricName = keyof typeof METRIC_DEFS;

export type MetricFilters = DateRange & {
  storeId?: number;
  regionId?: number;
  productId?: number;
};

export async function getMetric(name: MetricName, filters: MetricFilters) {
  const storeJoin =
    filters.regionId != null ? sql`JOIN stores s ON s.id = m.store_id` : sql``;
  const storeFilter =
    filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
  const regionFilter =
    filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;

  const expr =
    name === 'net_sales'
      ? sql`COALESCE(SUM(m.net_sales), 0)`
      : name === 'units'
        ? sql`COALESCE(SUM(m.units), 0)::float8`
        : sql`COALESCE(SUM(m.net_sales) / NULLIF(SUM(m.order_count), 0), 0)`;

  const row = await sql<{ value: number | null }[]>`
    SELECT ${expr} AS value
    FROM store_day_metrics m
    ${storeJoin}
    WHERE m.day >= ${filters.from}::date
      AND m.day <= ${filters.to}::date
      ${storeFilter}
      ${regionFilter}
  `;

  return {
    metric: name,
    ...METRIC_DEFS[name],
    value: Number(row[0]?.value ?? 0),
    filters,
  };
}

export async function seriesByDay(filters: MetricFilters) {
  const storeJoin =
    filters.regionId != null ? sql`JOIN stores s ON s.id = m.store_id` : sql``;
  const storeFilter =
    filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
  const regionFilter =
    filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;

  return sql<{ day: string; net_sales: number; units: number; order_count: number }[]>`
    SELECT m.day::text AS day,
           SUM(m.net_sales)::float8 AS net_sales,
           SUM(m.units)::int AS units,
           SUM(m.order_count)::int AS order_count
    FROM store_day_metrics m
    ${storeJoin}
    WHERE m.day >= ${filters.from}::date
      AND m.day <= ${filters.to}::date
      ${storeFilter}
      ${regionFilter}
    GROUP BY m.day
    ORDER BY m.day
  `;
}

export async function breakdown(
  dimension: 'region' | 'store' | 'sku',
  filters: MetricFilters,
  limit = 12,
) {
  if (dimension === 'sku') {
    const storeFilter =
      filters.storeId != null ? sql`AND o.store_id = ${filters.storeId}` : sql``;
    const regionJoin =
      filters.regionId != null ? sql`JOIN stores s ON s.id = o.store_id` : sql``;
    const regionFilter =
      filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;
    const productFilter =
      filters.productId != null ? sql`AND oi.product_id = ${filters.productId}` : sql``;
    return sql<{ key: string; label: string; net_sales: number; units: number }[]>`
      SELECT p.id::text AS key, p.name AS label,
             SUM(oi.line_total)::float8 AS net_sales,
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
        ${productFilter}
      GROUP BY p.id, p.name
      ORDER BY net_sales DESC
      LIMIT ${limit}
    `;
  }

  if (dimension === 'store') {
    const storeFilter =
      filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
    const regionFilter =
      filters.regionId != null ? sql`AND s.region_id = ${filters.regionId}` : sql``;
    return sql<{ key: string; label: string; net_sales: number; units: number }[]>`
      SELECT s.id::text AS key, s.name AS label,
             SUM(m.net_sales)::float8 AS net_sales,
             SUM(m.units)::int AS units
      FROM store_day_metrics m
      JOIN stores s ON s.id = m.store_id
      WHERE m.day >= ${filters.from}::date
        AND m.day <= ${filters.to}::date
        ${storeFilter}
        ${regionFilter}
      GROUP BY s.id, s.name
      ORDER BY net_sales DESC
      LIMIT ${limit}
    `;
  }

  const storeFilter =
    filters.storeId != null ? sql`AND m.store_id = ${filters.storeId}` : sql``;
  const regionFilter =
    filters.regionId != null ? sql`AND r.id = ${filters.regionId}` : sql``;
  return sql<{ key: string; label: string; net_sales: number; units: number }[]>`
    SELECT r.id::text AS key, r.name AS label,
           SUM(m.net_sales)::float8 AS net_sales,
           SUM(m.units)::int AS units
    FROM store_day_metrics m
    JOIN stores s ON s.id = m.store_id
    JOIN regions r ON r.id = s.region_id
    WHERE m.day >= ${filters.from}::date
      AND m.day <= ${filters.to}::date
      ${storeFilter}
      ${regionFilter}
    GROUP BY r.id, r.name
    ORDER BY net_sales DESC
    LIMIT ${limit}
  `;
}

export async function kpiBundle(filters: MetricFilters) {
  const [net, units, aov] = await Promise.all([
    getMetric('net_sales', filters),
    getMetric('units', filters),
    getMetric('aov', filters),
  ]);
  return { net_sales: net.value, units: units.value, aov: aov.value };
}
