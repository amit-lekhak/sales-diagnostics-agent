import 'dotenv/config';
import { addDays, format, parseISO } from 'date-fns';
import postgres from 'postgres';
import { embedTexts, toVectorLiteral } from '../src/lib/embeddings';
import { DATA_END, DATA_START } from '../src/lib/dates';

const sql = postgres(process.env.DATABASE_URL ?? 'postgres://localhost:5432/northstar', {
  max: 4,
});

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260909);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

const CATEGORIES = [
  [
    'beverages',
    ['Sparkle Cola', 'Citrus Fizz', 'Mango Nectar', 'Green Tea', 'Cold Brew'],
  ],
  ['snacks', ['Sea Salt Chips', 'Masala Mix', 'Trail Nuts', 'Rice Cakes', 'Cookie Pack']],
  [
    'personal',
    ['ShieldGuard Soap', 'Mint Toothpaste', 'Aloe Lotion', 'Face Wash', 'Shampoo'],
  ],
  [
    'household',
    ['Fresh Breeze Detergent', 'Dish Gel', 'Trash Bags', 'Sponge 6pk', 'Floor Cleaner'],
  ],
] as const;

async function reset() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
  await sql`TRUNCATE TABLE
    agent_spans, agent_runs, messages, conversations,
    news_chunks, news_articles, company_events, weather_daily, holidays,
    store_day_metrics, order_items, orders, promotions, products, stores, regions
    RESTART IDENTITY CASCADE`;
}

async function seedDimensions() {
  const regionRows = await sql<{ id: number; code: string }[]>`
    INSERT INTO regions (name, code) VALUES
      ('West', 'WEST'),
      ('North', 'NORTH'),
      ('South', 'SOUTH'),
      ('East', 'EAST')
    RETURNING id, code
  `;
  const region = Object.fromEntries(regionRows.map((r) => [r.code, r.id]));

  const storeDefs = [
    {
      name: 'Mumbai Andheri',
      city: 'Mumbai',
      lat: 19.1197,
      lon: 72.8464,
      region: 'WEST',
    },
    { name: 'Mumbai Bandra', city: 'Mumbai', lat: 19.0596, lon: 72.8295, region: 'WEST' },
    { name: 'Pune Koregaon', city: 'Pune', lat: 18.5362, lon: 73.8939, region: 'WEST' },
    {
      name: 'Delhi Connaught',
      city: 'Delhi',
      lat: 28.6328,
      lon: 77.2197,
      region: 'NORTH',
    },
    { name: 'Delhi Saket', city: 'Delhi', lat: 28.5244, lon: 77.2066, region: 'NORTH' },
    {
      name: 'Bengaluru Indiranagar',
      city: 'Bengaluru',
      lat: 12.9784,
      lon: 77.6408,
      region: 'SOUTH',
    },
    {
      name: 'Chennai Nungambakkam',
      city: 'Chennai',
      lat: 13.0569,
      lon: 80.2425,
      region: 'SOUTH',
    },
    {
      name: 'Kolkata Park Street',
      city: 'Kolkata',
      lat: 22.5548,
      lon: 88.3516,
      region: 'EAST',
    },
  ];

  const stores = await sql<{ id: number; name: string; city: string }[]>`
    INSERT INTO stores ${sql(
      storeDefs.map((s) => ({
        region_id: region[s.region],
        name: s.name,
        city: s.city,
        lat: s.lat,
        lon: s.lon,
      })),
    )}
    RETURNING id, name, city
  `;

  const productRows: {
    sku: string;
    name: string;
    category: string;
    unit_price: number;
  }[] = [];
  let skuN = 1;
  for (const [category, names] of CATEGORIES) {
    for (const name of names) {
      for (let variant = 1; variant <= 2; variant++) {
        productRows.push({
          sku: `NS-${String(skuN).padStart(4, '0')}`,
          name: variant === 1 ? name : `${name} XL`,
          category,
          unit_price: Math.round((40 + rand() * 420) * 100) / 100,
        });
        skuN += 1;
      }
    }
  }

  const products = await sql<{ id: number; name: string; unit_price: number }[]>`
    INSERT INTO products ${sql(productRows)}
    RETURNING id, name, unit_price
  `;

  const shield = products.find((p) => p.name.startsWith('ShieldGuard'))!;
  const pune = stores.find((s) => s.name.startsWith('Pune'))!;
  const west = region.WEST;

  await sql`
    INSERT INTO promotions (name, starts_on, ends_on, region_id, product_id)
    VALUES
      ('Summer Refresh', '2026-05-01', '2026-06-15', ${west}, NULL),
      ('Festival Bundle', '2025-10-10', '2025-10-26', ${region.NORTH}, NULL)
  `;

  return { region, stores, products, shield, pune };
}

function isJuly2026(day: string) {
  return day >= '2026-07-01' && day <= '2026-07-31';
}

function isDiwaliWeek(day: string) {
  return day >= '2025-10-18' && day <= '2025-10-26';
}

function isPromoWindow(day: string) {
  return day >= '2026-05-01' && day <= '2026-06-15';
}

async function seedOrders(
  stores: { id: number; name: string; city: string }[],
  products: { id: number; name: string; unit_price: number }[],
  shieldId: number,
) {
  const start = parseISO(DATA_START);
  const end = parseISO(DATA_END);
  const orderBatch: {
    store_id: number;
    status: string;
    paid_at: Date;
    subtotal: number;
    created_at: Date;
  }[] = [];
  const itemPlan: {
    orderIndex: number;
    productId: number;
    qty: number;
    unitPrice: number;
  }[] = [];
  let planned = 0;

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const day = format(d, 'yyyy-MM-dd');
    for (const store of stores) {
      let n = 8 + Math.floor(rand() * 8);
      if (store.city === 'Mumbai' && isJuly2026(day))
        n = Math.max(3, Math.round(n * 0.55));
      if (store.city === 'Delhi' && isDiwaliWeek(day)) n = Math.round(n * 1.7);
      if (store.name.startsWith('Pune') && isPromoWindow(day)) n = Math.round(n * 1.35);
      if (store.name.startsWith('Pune') && day > '2026-06-15' && day <= '2026-06-30') {
        n = Math.max(4, Math.round(n * 0.7));
      }
      const dow = d.getDay();
      if (dow === 0 || dow === 6) n = Math.round(n * 1.15);

      for (let i = 0; i < n; i++) {
        const hour = 9 + Math.floor(rand() * 12);
        const paid = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00+05:30`);
        const status = rand() < 0.96 ? 'paid' : pick(['cancelled', 'refunded']);
        const itemCount = 1 + Math.floor(rand() * 3);
        let subtotal = 0;
        const thisOrderIndex = planned;
        for (let k = 0; k < itemCount; k++) {
          let product = pick(products);
          if (
            store.city === 'Mumbai' &&
            isJuly2026(day) &&
            day >= '2026-07-08' &&
            day <= '2026-07-22' &&
            product.id === shieldId
          ) {
            product = pick(products.filter((p) => p.id !== shieldId));
          }
          const qty = 1 + Math.floor(rand() * 3);
          const unitPrice = product.unit_price * (0.92 + rand() * 0.12);
          subtotal += qty * unitPrice;
          itemPlan.push({
            orderIndex: thisOrderIndex,
            productId: product.id,
            qty,
            unitPrice: Math.round(unitPrice * 100) / 100,
          });
        }
        orderBatch.push({
          store_id: store.id,
          status,
          paid_at: status === 'paid' ? paid : (null as unknown as Date),
          subtotal: Math.round(subtotal * 100) / 100,
          created_at: paid,
        });
        planned += 1;

        if (orderBatch.length >= 800) {
          await flushOrders(orderBatch, itemPlan);
          orderBatch.length = 0;
          itemPlan.length = 0;
          planned = 0;
        }
      }
    }
  }
  if (orderBatch.length) await flushOrders(orderBatch, itemPlan);
}

async function flushOrders(
  orders: {
    store_id: number;
    status: string;
    paid_at: Date | null;
    subtotal: number;
    created_at: Date;
  }[],
  items: { orderIndex: number; productId: number; qty: number; unitPrice: number }[],
) {
  const inserted = await sql<{ id: number }[]>`
    INSERT INTO orders ${sql(orders)}
    RETURNING id
  `;
  const rows = items.map((it) => ({
    order_id: inserted[it.orderIndex]!.id,
    product_id: it.productId,
    qty: it.qty,
    unit_price: it.unitPrice,
    line_total: Math.round(it.qty * it.unitPrice * 100) / 100,
  }));
  for (let i = 0; i < rows.length; i += 1000) {
    await sql`INSERT INTO order_items ${sql(rows.slice(i, i + 1000))}`;
  }
}

async function rollupMetrics() {
  await sql`
    INSERT INTO store_day_metrics (store_id, day, net_sales, units, order_count, avg_price)
    SELECT o.store_id,
           o.paid_at::date AS day,
           SUM(oi.line_total),
           SUM(oi.qty),
           COUNT(DISTINCT o.id),
           SUM(oi.line_total) / NULLIF(SUM(oi.qty), 0)
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.status = 'paid' AND o.paid_at IS NOT NULL
    GROUP BY o.store_id, o.paid_at::date
  `;
}

async function seedContext(
  stores: { id: number; name: string; city: string }[],
  region: Record<string, number>,
  shieldId: number,
) {
  await sql`
    INSERT INTO holidays (date, name, region_id) VALUES
      ('2025-10-20', 'Diwali', ${region.NORTH}),
      ('2025-10-21', 'Diwali (observed)', ${region.NORTH}),
      ('2026-01-26', 'Republic Day', NULL),
      ('2026-03-14', 'Holi', NULL),
      ('2026-08-15', 'Independence Day', NULL)
  `;

  const start = parseISO(DATA_START);
  const end = parseISO(DATA_END);
  const weather: {
    store_id: number;
    date: string;
    rain_mm: number;
    temp_c: number;
    conditions: string;
    source: string;
  }[] = [];

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const day = format(d, 'yyyy-MM-dd');
    for (const store of stores) {
      let rain = rand() * 4;
      let temp = 24 + rand() * 10;
      let conditions = 'Clear';
      if (store.city === 'Mumbai' && isJuly2026(day)) {
        rain = 18 + rand() * 28;
        temp = 26 + rand() * 4;
        conditions = 'Heavy rain';
      } else if (day >= '2026-06-01' && day <= '2026-09-01' && store.city !== 'Delhi') {
        rain = 4 + rand() * 12;
        conditions = rain > 10 ? 'Rain' : 'Clouds';
      } else if (rain > 2.5) {
        conditions = 'Light rain';
      }
      weather.push({
        store_id: store.id,
        date: day,
        rain_mm: Math.round(rain * 10) / 10,
        temp_c: Math.round(temp * 10) / 10,
        conditions,
        source: 'seed',
      });
    }
  }
  for (let i = 0; i < weather.length; i += 800) {
    await sql`INSERT INTO weather_daily ${sql(weather.slice(i, i + 800))}`;
  }

  const mumbaiAndheri = stores.find((s) => s.name === 'Mumbai Andheri')!;
  await sql`
    INSERT INTO company_events (starts_on, ends_on, type, store_id, product_id, notes) VALUES
      ('2026-07-08', '2026-07-22', 'stockout', ${mumbaiAndheri.id}, ${shieldId},
        'ShieldGuard soap out of stock at Mumbai Andheri after delayed inbound.'),
      ('2026-05-01', '2026-06-15', 'promo', NULL, NULL,
        'Summer Refresh promo across West region. Ended 15 Jun 2026.'),
      ('2026-04-03', '2026-04-03', 'outage', NULL, NULL,
        'POS outage 11:00-14:30 IST. Some stores processed cash only.')
  `;

  const articles = [
    {
      source: 'Trade Daily',
      published_at: new Date('2026-06-12T09:00:00+05:30'),
      title: 'Nhava Sheva port congestion delays FMCG inbound',
      body: 'Container dwell times at Nhava Sheva rose to 9 days. Personal care and detergent refill packs for West India retailers are the most affected SKUs. Analysts expect stockouts into July if yards do not clear.',
      region_id: region.WEST,
      product_id: shieldId,
    },
    {
      source: 'Retail Pulse',
      published_at: new Date('2026-07-02T08:00:00+05:30'),
      title: 'Competitor SparkHome launches discount week in South',
      body: 'SparkHome cut detergent prices 18% in Bengaluru and Chennai. Northstar Mart South stores reported browsing uptick but mixed conversion. This is a South-only promo.',
      region_id: region.SOUTH,
      product_id: null,
    },
    {
      source: 'Weather Desk',
      published_at: new Date('2026-06-28T07:00:00+05:30'),
      title: 'Mumbai monsoon intensifies; foot traffic expected to fall',
      body: 'IMD warned of heavy rain clusters over Mumbai through July. Mall and high-street retailers typically see 15-30% fewer walk-ins on 20mm+ rain days.',
      region_id: region.WEST,
      product_id: null,
    },
  ];

  const inserted = await sql<{ id: number; title: string; body: string }[]>`
    INSERT INTO news_articles ${sql(articles)}
    RETURNING id, title, body
  `;

  const chunks = inserted.map((a) => `${a.title}. ${a.body}`);
  const { vectors, provider } = await embedTexts(chunks);
  console.log(`News embeddings via ${provider}`);
  for (let i = 0; i < inserted.length; i++) {
    const vec = toVectorLiteral(vectors[i]!);
    await sql.unsafe(
      `INSERT INTO news_chunks (article_id, chunk_index, text, embedding, date_from, date_to, region_id)
       VALUES ($1, 0, $2, $3::vector, $4, $5, $6)`,
      [
        inserted[i]!.id,
        chunks[i]!,
        vec,
        i === 0 ? '2026-06-01' : i === 1 ? '2026-07-01' : '2026-06-20',
        i === 0 ? '2026-07-31' : i === 1 ? '2026-07-15' : '2026-07-31',
        i === 1 ? region.SOUTH : region.WEST,
      ],
    );
  }
  await sql.unsafe(
    `CREATE INDEX IF NOT EXISTS news_chunks_embedding_idx ON news_chunks USING hnsw (embedding vector_cosine_ops)`,
  );
}

async function main() {
  console.log('Seeding Northstar Mart…');
  await reset();
  const { region, stores, products, shield } = await seedDimensions();
  console.log(`Stores ${stores.length}, products ${products.length}`);
  await seedOrders(stores, products, shield.id);
  console.log('Rolling up daily metrics…');
  await rollupMetrics();
  await seedContext(stores, region, shield.id);
  const counts = await sql<{ orders: string; items: string; days: string }[]>`
    SELECT
      (SELECT COUNT(*)::text FROM orders) AS orders,
      (SELECT COUNT(*)::text FROM order_items) AS items,
      (SELECT COUNT(*)::text FROM store_day_metrics) AS days
  `;
  console.log(counts[0]);
  console.log('Seed complete.');
}

main()
  .then(async () => {
    await sql.end({ timeout: 5 });
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end({ timeout: 5 });
    process.exit(1);
  });
