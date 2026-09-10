import { sql } from './db';

export type DimensionRow = {
  storeId: number;
  store: string;
  city: string;
  regionId: number;
  region: string;
};

const DIMENSIONS_TTL_MS = 60_000;
let dimensionsCache: { at: number; rows: DimensionRow[] } | null = null;

export async function loadDimensions(): Promise<DimensionRow[]> {
  const now = Date.now();
  if (dimensionsCache && now - dimensionsCache.at < DIMENSIONS_TTL_MS) {
    return dimensionsCache.rows;
  }
  const rows = await sql<DimensionRow[]>`
    SELECT s.id AS "storeId", s.name AS store, s.city,
           r.id AS "regionId", r.name AS region
    FROM stores s
    JOIN regions r ON r.id = s.region_id
    ORDER BY r.id, s.id
  `;
  dimensionsCache = { at: now, rows };
  return rows;
}

/** Test helper — clear the in-memory dimensions cache. */
export function clearDimensionsCache() {
  dimensionsCache = null;
}

export function formatDimensionsPrompt(rows: DimensionRow[]): string {
  const regions = new Map<number, string>();
  for (const row of rows) regions.set(row.regionId, row.region);
  const regionLines = [...regions.entries()]
    .map(([id, name]) => `- ${name} (regionId=${id})`)
    .join('\n');
  const storeLines = rows
    .map((s) => `- ${s.store} (storeId=${s.storeId}, city ${s.city}, region ${s.region})`)
    .join('\n');
  return `Places (pass storeName/regionName on tools; IDs also work):
Regions:
${regionLines}
Stores:
${storeLines}
City shortcuts: Mumbai = both Mumbai stores (pass storeName="Mumbai"); Pune = Pune Koregaon; Delhi = both Delhi stores (North region).`;
}

export type PlaceFilter = {
  storeId?: number;
  regionId?: number;
  city?: string;
};

export async function resolvePlace(input: {
  storeId?: number;
  regionId?: number;
  storeName?: string;
  regionName?: string;
}): Promise<PlaceFilter> {
  const out: PlaceFilter = {
    storeId: input.storeId,
    regionId: input.regionId,
  };
  if (input.regionName) {
    const rows = await sql<{ id: number }[]>`
      SELECT id FROM regions WHERE name ILIKE ${input.regionName.trim()} LIMIT 1
    `;
    if (rows[0]) out.regionId = rows[0].id;
  }
  const raw = input.storeName?.trim();
  if (!raw) return out;
  const exact = await sql<{ id: number }[]>`
    SELECT id FROM stores WHERE name ILIKE ${raw} LIMIT 1
  `;
  if (exact[0]) {
    out.storeId = exact[0].id;
    return out;
  }
  const byName = await sql<{ id: number }[]>`
    SELECT id FROM stores WHERE name ILIKE ${'%' + raw + '%'}
  `;
  if (byName.length === 1) {
    out.storeId = byName[0]!.id;
    return out;
  }
  const byCity = await sql<{ id: number; city: string }[]>`
    SELECT id, city FROM stores WHERE city ILIKE ${raw}
  `;
  if (byCity.length === 1) {
    out.storeId = byCity[0]!.id;
  } else if (byCity.length > 1) {
    out.city = byCity[0]!.city;
    out.storeId = undefined;
  }
  return out;
}

export async function resolveProduct(input: {
  productId?: number;
  productName?: string;
}): Promise<number | undefined> {
  if (input.productId != null) return input.productId;
  const raw = input.productName?.trim();
  if (!raw) return undefined;
  const exact = await sql<{ id: number }[]>`
    SELECT id FROM products WHERE name ILIKE ${raw} LIMIT 1
  `;
  if (exact[0]) return exact[0].id;
  const byName = await sql<{ id: number }[]>`
    SELECT id FROM products WHERE name ILIKE ${'%' + raw + '%'} LIMIT 2
  `;
  if (byName.length === 1) return byName[0]!.id;
  const bySku = await sql<{ id: number }[]>`
    SELECT id FROM products WHERE sku ILIKE ${raw} LIMIT 1
  `;
  return bySku[0]?.id;
}
