# Northstar Mart — sales diagnostics agent

Learning app: a fake retailer dashboard plus a Gemini chat that answers **only from Postgres tools**. Weather and news are ingested, then queried. The model does not invent sales figures.

## Prerequisites

- Node 20+ and pnpm
- Local Postgres (no Docker). This repo was developed against Postgres 14.
- `pgvector` extension (`CREATE EXTENSION vector;`)
- Optional: Google AI Studio key, OpenWeather key, OpenRouter key

### pgvector on Homebrew Postgres 14

If `SELECT * FROM pg_available_extensions WHERE name = 'vector'` is empty, build pgvector against **the same** `pg_config` as the running server (not libpq 17):

```bash
git clone --depth 1 --branch v0.8.1 https://github.com/pgvector/pgvector.git /tmp/pgvector
# If clang complains about a missing MacOSX14.sdk, wrap clang so it uses the current Xcode SDK.
make PG_CONFIG=/opt/homebrew/opt/postgresql@14/bin/pg_config
make install PG_CONFIG=/opt/homebrew/opt/postgresql@14/bin/pg_config
```

```bash
createdb northstar
psql -d northstar -c "CREATE EXTENSION vector;"
```

## Setup

```bash
cd sales_diagnostics_agent
cp .env.example .env.local
# set DATABASE_URL and GEMINI_API_KEY
pnpm install
pnpm db:push
pnpm db:seed
pnpm weather:sync   # optional; needs OPENWEATHER_API_KEY
pnpm dev
```

Open http://localhost:3000

Vercel: deploy this folder as the Next.js root. Point `DATABASE_URL` at hosted Postgres **with pgvector** (Neon or Supabase). Do not use Docker.

## Demo questions

1. Overview, default dates: **What were net sales last month?** — must match the Overview KPI for that window (ask with explicit August 2026 dates if the model is vague).
2. On `/stores?regionId=1` with **This page**: **How did West stores do in July 2026?**
3. **Why did sales drop in July 2026 in Mumbai?** — expect a store breakdown, rain overlap, ShieldGuard stockout, and an unexplained remainder. Not “rain caused it.”

Schema SQL lives in `drizzle/0000_init.sql`. Day-to-day local setup still uses `pnpm db:push`.

## Scripts

- `pnpm db:seed` / `pnpm db:reset` — wipe and reload planted stories
- `pnpm weather:sync` — OpenWeather current + 5-day forecast upserted into `weather_daily`
- `pnpm eval` — golden SQL + semantic evals (oracle layer, then Gemini agent). `--skip-agent`, `--type sql|semantic`, `--scenario mumbai_july`, `--id sql-net-sales-last-month`
- `pnpm lint` / `pnpm format` — ESLint check; Prettier rewrite (not on save)

## Evals

Seeded Postgres is the source of truth — cases do not freeze paise. Re-seed, then run:

```bash
pnpm db:seed
pnpm eval
```

`pnpm eval -- --skip-agent` scores the metric SQL layer and news retrieval without Gemini. Full `pnpm eval` calls Gemini on every case (often 3–5 minutes) and prints progress as each case finishes; agent calls abort after 90s (`EVAL_AGENT_TIMEOUT_MS`). RAG recall needs the **same embedding provider as seed** (Gemini vs the hash fallback will miss titles; those cases are skipped with a warning instead of a silent fail). JSON reports land in `evals/results/`.

## Format vs agent edits

Workspace `.vscode/settings.json` turns **format on save** and **ESLint fix on save** off so Cmd+S does not rewrite agent edits. Format only with `pnpm format` or Format Document.

## Planted stories in seed data

- Mumbai July 2026: heavy rain + ShieldGuard stockout at Andheri
- Delhi late Oct 2025: Diwali spike
- Pune: Summer Refresh promo ends 15 Jun 2026 (drop is not weather)
