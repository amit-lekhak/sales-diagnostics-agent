import { sql } from './db';

export type DimensionRow = {
  storeId: number;
  store: string;
  city: string;
  regionId: number;
  region: string;
};

export async function loadDimensions(): Promise<DimensionRow[]> {
  return sql<DimensionRow[]>`
    SELECT s.id AS "storeId", s.name AS store, s.city,
           r.id AS "regionId", r.name AS region
    FROM stores s
    JOIN regions r ON r.id = s.region_id
    ORDER BY r.id, s.id
  `;
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
