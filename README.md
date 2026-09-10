# Northstar Mart — sales diagnostics agent

Retail analytics dashboard with a Gemini chat that answers **only from Postgres-backed tools**. Weather and news are ingested, then queried — the model does not invent sales figures.

## Documentation

| Doc                                                 | For                                              |
| --------------------------------------------------- | ------------------------------------------------ |
| [docs/](docs/README.md)                             | Tutorial, how-tos, reference, design explanation |
| [Getting started](docs/tutorial-getting-started.md) | Install → seed → first chat answer               |
| [Architecture](diagrams/ARCHITECTURE.md)            | Runtime and evals diagrams                       |

## Prerequisites

- Node 20+ and pnpm
- Postgres 14+ with the `pgvector` extension (`CREATE EXTENSION vector;`)
- Optional: Google AI Studio key, OpenWeather key, OpenRouter key

### pgvector setup

If `SELECT * FROM pg_available_extensions WHERE name = 'vector'` is empty, install pgvector against the same `pg_config` as your running server, then:

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

Deploy this folder as the Next.js root (e.g. Vercel). Point `DATABASE_URL` at hosted Postgres **with pgvector** (Neon or Supabase).

## Example questions

1. Overview: **What were net sales last month?**
2. On `/stores?regionId=1` with page scope: **How did West stores do in July 2026?**
3. **Why did sales drop in July 2026 in Mumbai?** — store breakdown, rain overlap, ShieldGuard stockout, and an unexplained remainder.

Schema SQL lives in `drizzle/0000_init.sql`. Day-to-day setup uses `pnpm db:push`.

## Scripts

- `pnpm db:seed` / `pnpm db:reset` — wipe and reload seed data
- `pnpm weather:sync` — OpenWeather current + 5-day forecast upserted into `weather_daily`
- `pnpm eval` — golden SQL + semantic evals (oracle layer, then Gemini agent). `--skip-agent`, `--type sql|semantic`, `--scenario mumbai_july`, `--id sql-net-sales-last-month`
- `pnpm lint` / `pnpm format` — ESLint check; Prettier rewrite
- `pnpm test` — unit tests (provider errors, slot rules, dates, optional DB metrics)

## Evals

Seeded Postgres is the source of truth — cases do not freeze paise. Re-seed, then run:

```bash
pnpm db:seed
pnpm eval
```

`pnpm eval -- --skip-agent` scores the metric SQL layer and news retrieval without Gemini. Full `pnpm eval` calls Gemini on every case (often 3–5 minutes) and prints progress as each case finishes; agent calls abort after 90s (`EVAL_AGENT_TIMEOUT_MS`). RAG recall needs the **same embedding provider as seed** (Gemini vs the hash fallback will miss titles; those cases are skipped with a warning instead of a silent fail). JSON reports land in `evals/results/`.

Unit tests (no Gemini required for most):

```bash
pnpm test
```

## Seed scenarios

- Mumbai July 2026: heavy rain + ShieldGuard stockout at Andheri
- Delhi late Oct 2025: Diwali spike
- Pune: Summer Refresh promo ends 15 Jun 2026 (drop is not weather)
