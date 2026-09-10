# Getting started with Northstar Mart

You will run the retail dashboard locally, load seed data, and get a grounded answer from the sales diagnostics chat. By the end you will see Overview KPIs and a chat reply that quotes tool `display` values from Postgres.

## What you'll need

- Node 20+ and [pnpm](https://pnpm.io)
- Postgres 14+ with the [`pgvector`](https://github.com/pgvector/pgvector) extension
- A [Google AI Studio](https://aistudio.google.com) API key (`GEMINI_API_KEY`) for live chat

Optional later: `OPENWEATHER_API_KEY` for live weather upserts.

## Step 1: Create the database

```bash
createdb northstar
psql -d northstar -c "CREATE EXTENSION vector;"
```

If `vector` is missing from `pg_available_extensions`, install pgvector against the same `pg_config` as your running Postgres server, then re-run `CREATE EXTENSION`.

## Step 2: Install and configure

```bash
cd sales_diagnostics_agent
cp .env.example .env.local
```

Edit `.env.local`:

- Set `DATABASE_URL` (default `postgres://localhost:5432/northstar`)
- Set `GEMINI_API_KEY`

Then:

```bash
pnpm install
pnpm db:push
pnpm db:seed
```

`db:push` creates tables (and ensures extensions). `db:seed` loads regions, stores, orders, weather, events, and news for the window `2025-03-01` … `2026-09-09`.

## Step 3: Start the app and ask a question

```bash
pnpm dev
```

Open http://localhost:3000. You should see Overview KPIs (Net sales, Units, AOV).

1. Click **Ask sales** in the corner.
2. Click the suggested chip **What were net sales last month?** (or type it).
3. Send.

You should get a reply that includes a rupee amount from the semantic layer (for example matching last-month net sales on Overview when dates align). Open **Trace / sources** under the reply to see which tools ran.

## What you built

A local Northstar Mart desk: dashboard pages backed by `store_day_metrics` / order lines, plus a Gemini analyst that can only answer through six Postgres tools.

Next:

- [How to diagnose sales drops](howto-diagnose-sales.md) - Mumbai July, page scope, causation hygiene
- [How to run evals](howto-run-evals.md) - lock in the metric SQL and agent behavior
- [Reference: Runtime](reference-runtime.md) - APIs, tools, env vars
