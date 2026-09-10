import { sql } from '../src/lib/db';
import { defaultRange } from '../src/lib/dates';
import { resolvePlace, resolveProduct } from '../src/lib/dimensions';
import type { MetricFilters } from '../src/lib/metrics';
import type { PageContext } from '../src/lib/page-context';
import type { FilterSpec, PageSpec } from './cases';

export type Catalog = {
  regions: Map<string, number>;
  stores: Map<string, { id: number; city: string; regionId: number }>;
};

export async function assertSeeded() {
  const [row] = await sql<{ orders: number; days: number; news: number }[]>`
    SELECT
      (SELECT COUNT(*)::int FROM orders) AS orders,
      (SELECT COUNT(*)::int FROM store_day_metrics) AS days,
      (SELECT COUNT(*)::int FROM news_articles) AS news
  `;
  if (!row || row.orders === 0 || row.days === 0) {
    throw new Error(
      'Seed data missing (orders/store_day_metrics empty). Run pnpm db:seed first.',
    );
  }
  if (row.news === 0) {
    throw new Error('Seed data missing news_articles. Run pnpm db:seed first.');
  }
}

export async function loadCatalog(): Promise<Catalog> {
  const regions = await sql<{ id: number; name: string }[]>`
    SELECT id, name FROM regions
  `;
  const stores = await sql<
    { id: number; name: string; city: string; region_id: number }[]
  >`
    SELECT id, name, city, region_id FROM stores
  `;
  return {
    regions: new Map(regions.map((r) => [r.name, r.id])),
    stores: new Map(
      stores.map((s) => [s.name, { id: s.id, city: s.city, regionId: s.region_id }]),
    ),
  };
}

/** Same place resolution as the live agent (city shortcuts like Mumbai). */
export async function resolveFilter(
  _catalog: Catalog,
  spec: FilterSpec,
): Promise<MetricFilters> {
  const fallback = defaultRange();
  const place = await resolvePlace({
    storeName: spec.storeName,
    regionName: spec.regionName,
  });
  if (spec.storeName && place.storeId == null && !place.city) {
    throw new Error(`Unknown store "${spec.storeName}"`);
  }
  if (spec.regionName && place.regionId == null) {
    throw new Error(`Unknown region "${spec.regionName}"`);
  }
  const productId = await resolveProduct({ productName: spec.productName });
  if (spec.productName && productId == null) {
    throw new Error(`Unknown product "${spec.productName}"`);
  }
  return {
    from: spec.from ?? fallback.from,
    to: spec.to ?? fallback.to,
    storeId: place.storeId,
    regionId: place.regionId,
    city: place.city,
    productId,
  };
}

export async function resolvePage(
  _catalog: Catalog,
  spec: PageSpec,
): Promise<PageContext> {
  const place = await resolvePlace({
    storeName: spec.storeName,
    regionName: spec.regionName,
  });
  if (spec.storeName && place.storeId == null && !place.city) {
    throw new Error(`Unknown store "${spec.storeName}"`);
  }
  if (spec.regionName && place.regionId == null) {
    throw new Error(`Unknown region "${spec.regionName}"`);
  }
  const productId = await resolveProduct({ productName: spec.productName });
  if (spec.productName && productId == null) {
    throw new Error(`Unknown product "${spec.productName}"`);
  }
  return {
    page: spec.page,
    pathname: spec.pathname,
    from: spec.from,
    to: spec.to,
    storeId: place.storeId,
    regionId: place.regionId,
    productId,
  };
}
