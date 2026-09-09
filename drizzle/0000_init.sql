-- Northstar Mart schema snapshot (pgvector required: CREATE EXTENSION vector;)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS regions (
  id serial PRIMARY KEY,
  name varchar(80) NOT NULL,
  code varchar(16) NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id serial PRIMARY KEY,
  region_id integer NOT NULL REFERENCES regions(id),
  name varchar(120) NOT NULL,
  city varchar(80) NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS stores_region_idx ON stores (region_id);

CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  sku varchar(32) NOT NULL,
  name varchar(160) NOT NULL,
  category varchar(80) NOT NULL,
  unit_price double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS promotions (
  id serial PRIMARY KEY,
  name varchar(160) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  region_id integer REFERENCES regions(id),
  product_id integer REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  store_id integer NOT NULL REFERENCES stores(id),
  status varchar(24) NOT NULL,
  paid_at timestamptz,
  subtotal double precision NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_store_paid_idx ON orders (store_id, paid_at);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

CREATE TABLE IF NOT EXISTS order_items (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id),
  product_id integer NOT NULL REFERENCES products(id),
  qty integer NOT NULL,
  unit_price double precision NOT NULL,
  line_total double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id);

CREATE TABLE IF NOT EXISTS store_day_metrics (
  store_id integer NOT NULL REFERENCES stores(id),
  day date NOT NULL,
  net_sales double precision NOT NULL,
  units integer NOT NULL,
  order_count integer NOT NULL,
  avg_price double precision NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS store_day_metrics_pk ON store_day_metrics (store_id, day);
CREATE INDEX IF NOT EXISTS store_day_metrics_day_idx ON store_day_metrics (day);

CREATE TABLE IF NOT EXISTS holidays (
  id serial PRIMARY KEY,
  date date NOT NULL,
  name varchar(120) NOT NULL,
  region_id integer REFERENCES regions(id)
);

CREATE TABLE IF NOT EXISTS weather_daily (
  id serial PRIMARY KEY,
  store_id integer NOT NULL REFERENCES stores(id),
  date date NOT NULL,
  rain_mm double precision NOT NULL,
  temp_c double precision NOT NULL,
  conditions varchar(80) NOT NULL,
  source varchar(24) NOT NULL,
  fetched_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS weather_daily_store_date ON weather_daily (store_id, date);

CREATE TABLE IF NOT EXISTS company_events (
  id serial PRIMARY KEY,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  type varchar(40) NOT NULL,
  store_id integer REFERENCES stores(id),
  product_id integer REFERENCES products(id),
  notes text NOT NULL
);

CREATE TABLE IF NOT EXISTS news_articles (
  id serial PRIMARY KEY,
  source varchar(80) NOT NULL,
  published_at timestamptz NOT NULL,
  title varchar(240) NOT NULL,
  body text NOT NULL,
  region_id integer REFERENCES regions(id),
  product_id integer REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS news_chunks (
  id serial PRIMARY KEY,
  article_id integer NOT NULL REFERENCES news_articles(id),
  chunk_index integer NOT NULL,
  text text NOT NULL,
  embedding vector(768),
  date_from date,
  date_to date,
  region_id integer
);
CREATE INDEX IF NOT EXISTS news_chunks_article_idx ON news_chunks (article_id);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(200) NOT NULL DEFAULT 'New chat',
  summary text,
  summarized_through_message_id uuid,
  summary_updated_at timestamptz,
  last_page_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  role varchar(24) NOT NULL,
  content text NOT NULL,
  scope varchar(16) NOT NULL,
  page_context jsonb,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id),
  message_id uuid,
  model varchar(80) NOT NULL,
  status varchar(24) NOT NULL,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  error text,
  scope varchar(16),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_created_idx ON agent_runs (created_at);

CREATE TABLE IF NOT EXISTS agent_spans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id),
  parent_span_id uuid,
  kind varchar(24) NOT NULL,
  name varchar(120) NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  input jsonb,
  output jsonb,
  error text,
  token_count integer
);
CREATE INDEX IF NOT EXISTS agent_spans_run_idx ON agent_spans (run_id);
