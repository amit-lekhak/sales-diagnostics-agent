import '../load-env';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://localhost:5432/northstar');
const KEY = process.env.OPENWEATHER_API_KEY;

type ForecastItem = {
  dt: number;
  main: { temp: number };
  rain?: { '3h'?: number };
  weather: { main: string }[];
};

async function geocode(city: string) {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`geocode ${city} ${res.status}`);
  const json = (await res.json()) as { lat: number; lon: number }[];
  return json[0];
}

function dayKey(dt: number) {
  return new Date(dt * 1000).toISOString().slice(0, 10);
}

async function upsertDaily(
  storeId: number,
  rows: { date: string; rain_mm: number; temp_c: number; conditions: string }[],
) {
  for (const r of rows) {
    await sql`
      INSERT INTO weather_daily (store_id, date, rain_mm, temp_c, conditions, source, fetched_at)
      VALUES (${storeId}, ${r.date}::date, ${r.rain_mm}, ${r.temp_c}, ${r.conditions}, 'openweather', NOW())
      ON CONFLICT (store_id, date)
      DO UPDATE SET
        rain_mm = EXCLUDED.rain_mm,
        temp_c = EXCLUDED.temp_c,
        conditions = EXCLUDED.conditions,
        source = 'openweather',
        fetched_at = NOW()
    `;
  }
}

async function fetchStore(store: { id: number; city: string; lat: number; lon: number }) {
  let lat = store.lat;
  let lon = store.lon;
  if (!lat || !lon) {
    const geo = await geocode(store.city);
    if (geo) {
      lat = geo.lat;
      lon = geo.lon;
      await sql`UPDATE stores SET lat = ${lat}, lon = ${lon} WHERE id = ${store.id}`;
    }
  }
  const curRes = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${KEY}&units=metric`,
  );
  const fcRes = await fetch(
    `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${KEY}&units=metric`,
  );
  if (!curRes.ok || !fcRes.ok) {
    throw new Error(`openweather ${store.city} ${curRes.status}/${fcRes.status}`);
  }
  const current = (await curRes.json()) as {
    dt: number;
    main: { temp: number };
    rain?: { '1h'?: number; '3h'?: number };
    weather: { main: string }[];
  };
  const forecast = (await fcRes.json()) as { list: ForecastItem[] };
  const buckets = new Map<
    string,
    { rain: number; temp: number[]; conditions: string[] }
  >();
  const push = (dt: number, rain: number, temp: number, cond: string) => {
    const key = dayKey(dt);
    const b = buckets.get(key) ?? { rain: 0, temp: [], conditions: [] };
    b.rain += rain;
    b.temp.push(temp);
    b.conditions.push(cond);
    buckets.set(key, b);
  };
  push(
    current.dt,
    current.rain?.['1h'] ?? current.rain?.['3h'] ?? 0,
    current.main.temp,
    current.weather[0]?.main ?? 'Clear',
  );
  for (const item of forecast.list) {
    push(
      item.dt,
      item.rain?.['3h'] ?? 0,
      item.main.temp,
      item.weather[0]?.main ?? 'Clear',
    );
  }
  const rows = [...buckets.entries()].map(([date, b]) => ({
    date,
    rain_mm: Math.round(b.rain * 10) / 10,
    temp_c: Math.round((b.temp.reduce((s, n) => s + n, 0) / b.temp.length) * 10) / 10,
    conditions: b.conditions.sort((a, c) => c.length - a.length)[0] ?? 'Clear',
  }));
  await upsertDaily(store.id, rows);
  return rows.length;
}

export async function runWeatherSync() {
  if (!KEY) {
    console.log('OPENWEATHER_API_KEY missing — skipped. Seed weather remains.');
    return;
  }
  const stores = await sql<{ id: number; city: string; lat: number; lon: number }[]>`
    SELECT id, city, lat, lon FROM stores
  `;
  for (const store of stores) {
    const n = await fetchStore(store);
    console.log(`${store.city}: upserted ${n} days`);
  }
}

export async function closeWeatherSql() {
  await sql.end({ timeout: 5 });
}
