import {
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  varchar,
} from 'drizzle-orm/pg-core';

export const regions = pgTable('regions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  code: varchar('code', { length: 16 }).notNull(),
});

export const stores = pgTable(
  'stores',
  {
    id: serial('id').primaryKey(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    name: varchar('name', { length: 120 }).notNull(),
    city: varchar('city', { length: 80 }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
  },
  (t) => [index('stores_region_idx').on(t.regionId)],
);

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sku: varchar('sku', { length: 32 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  category: varchar('category', { length: 80 }).notNull(),
  unitPrice: integer('unit_price').notNull(),
});

export const promotions = pgTable('promotions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 160 }).notNull(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  regionId: integer('region_id').references(() => regions.id),
  productId: integer('product_id').references(() => products.id),
});

export const orders = pgTable(
  'orders',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id),
    status: varchar('status', { length: 24 }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    subtotal: integer('subtotal').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('orders_store_paid_idx').on(t.storeId, t.paidAt),
    index('orders_status_idx').on(t.status),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    qty: integer('qty').notNull(),
    unitPrice: integer('unit_price').notNull(),
    lineTotal: integer('line_total').notNull(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.productId),
  ],
);

export const storeDayMetrics = pgTable(
  'store_day_metrics',
  {
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id),
    day: date('day').notNull(),
    netSales: integer('net_sales').notNull(),
    units: integer('units').notNull(),
    orderCount: integer('order_count').notNull(),
    avgPrice: integer('avg_price').notNull(),
  },
  (t) => [
    uniqueIndex('store_day_metrics_pk').on(t.storeId, t.day),
    index('store_day_metrics_day_idx').on(t.day),
  ],
);

export const holidays = pgTable('holidays', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  regionId: integer('region_id').references(() => regions.id),
});

export const weatherDaily = pgTable(
  'weather_daily',
  {
    id: serial('id').primaryKey(),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id),
    date: date('date').notNull(),
    rainMm: doublePrecision('rain_mm').notNull(),
    tempC: doublePrecision('temp_c').notNull(),
    conditions: varchar('conditions', { length: 80 }).notNull(),
    source: varchar('source', { length: 24 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('weather_daily_store_date').on(t.storeId, t.date)],
);

export const companyEvents = pgTable('company_events', {
  id: serial('id').primaryKey(),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  type: varchar('type', { length: 40 }).notNull(),
  storeId: integer('store_id').references(() => stores.id),
  productId: integer('product_id').references(() => products.id),
  notes: text('notes').notNull(),
});

export const newsArticles = pgTable('news_articles', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 80 }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
  title: varchar('title', { length: 240 }).notNull(),
  body: text('body').notNull(),
  regionId: integer('region_id').references(() => regions.id),
  productId: integer('product_id').references(() => products.id),
});

export const newsChunks = pgTable(
  'news_chunks',
  {
    id: serial('id').primaryKey(),
    articleId: integer('article_id')
      .notNull()
      .references(() => newsArticles.id),
    chunkIndex: integer('chunk_index').notNull(),
    text: text('text').notNull(),
    embedding: vector('embedding', { dimensions: 768 }),
    dateFrom: date('date_from'),
    dateTo: date('date_to'),
    regionId: integer('region_id'),
  },
  (t) => [index('news_chunks_article_idx').on(t.articleId)],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull().default('New chat'),
  summary: text('summary'),
  summarizedThroughMessageId: uuid('summarized_through_message_id'),
  summaryUpdatedAt: timestamp('summary_updated_at', { withTimezone: true }),
  lastPageContext: jsonb('last_page_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id),
    role: varchar('role', { length: 24 }).notNull(),
    content: text('content').notNull(),
    scope: varchar('scope', { length: 16 }).notNull(),
    pageContext: jsonb('page_context'),
    runId: uuid('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').references(() => conversations.id),
    messageId: uuid('message_id'),
    model: varchar('model', { length: 80 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    error: text('error'),
    scope: varchar('scope', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_runs_created_idx').on(t.createdAt)],
);

export const agentSpans = pgTable(
  'agent_spans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id),
    parentSpanId: uuid('parent_span_id'),
    kind: varchar('kind', { length: 24 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    tokenCount: integer('token_count'),
  },
  (t) => [index('agent_spans_run_idx').on(t.runId)],
);
