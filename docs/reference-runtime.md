# Runtime reference

HTTP APIs, analyst tools, semantic metrics, and environment variables for the Northstar Mart sales diagnostics agent.

Money is integer **paise**. The model must quote tool `display` strings (₹ formatting), never invent amounts.

Seed / default date window: `DATA_START` = `2025-03-01`, `DATA_END` = `2026-09-09`. Dashboard default range is `{ from: '2026-08-11', to: DATA_END }` (`src/lib/dates.ts`).

## HTTP APIs

### `POST /api/chat`

Main chat runtime. Body (`chatRequestSchema`):

| Field            | Type              | Notes                                                                   |
| ---------------- | ----------------- | ----------------------------------------------------------------------- |
| `message`        | string            | Required, trimmed, 1–4000 chars                                         |
| `conversationId` | uuid \| null      | Optional; creates a conversation if omitted                             |
| `scope`          | `'page' \| 'all'` | Default `page`                                                          |
| `pageContext`    | object            | `page`, `pathname`, `from`, `to`, `storeId`, `regionId`, `productId`, … |

**Flow:** create run → topic guard → slot fill → Gemini `streamText` with tools (`stopWhen stepCountIs(8)`) or early JSON exit.

**Early JSON** (not SSE): missing key, scope refuse, clarify, soft-refuse unknown metric, provider errors, 400/404/500.

**SSE events** (`data: {json}\n\n`): `meta`, `delta`, `tool` (`phase: start|done`), `done`, `error`.

Route `maxDuration = 60`. Soft budget `CHAT_ROUTE_BUDGET_MS` (default 58000). Analyst abort uses remaining budget capped by `CHAT_ANALYST_TIMEOUT_MS` (default 45000), floor 5000 ms.

### Conversations

| Method   | Path                      | Behavior                                                             |
| -------- | ------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/api/conversations`      | Last 3 by `updated_at`                                               |
| `POST`   | `/api/conversations`      | Create (`title: New chat`)                                           |
| `GET`    | `/api/conversations/[id]` | Messages + summary                                                   |
| `DELETE` | `/api/conversations/[id]` | Delete conversation and messages; nulls `agent_runs.conversation_id` |

### Traces and labels

| Method | Path                  | Behavior                                 |
| ------ | --------------------- | ---------------------------------------- |
| `GET`  | `/api/traces/[runId]` | Spans for citations / ops UI             |
| `GET`  | `/api/labels`         | Regions, stores, products for chat chips |

## Analyst tools

Built in `src/lib/agent/ai-tools.ts`, executed via `src/lib/agent/tools.ts` with `ToolRuntime` `{ runId, scope, filters }`.

Shared location fields: `storeId`, `regionId`, `storeName`, `regionName`, `productId`, `productName`. Optional `period`: `page` | `last_month` | `last_quarter`.

| Tool                  | Inputs                                                                           | Returns                                                                                             |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `get_metric`          | `metric` (`net_sales` \| `units` \| `aov`), period/dates, location               | Metric def + `value`, `unit` (`paise` \| `count`), `display`, `filters` - or `{ ok: false, error }` |
| `breakdown`           | `dimension` (`region` \| `store` \| `sku`), dates/location, `limit?` (default 8) | `{ dimension, rows[], filters }` with `display` / `units_display`                                   |
| `compare_periods`     | `metric`, dates/location, `mode?` (`prior` \| `yoy`, default prior)              | `current` / `baseline`, `delta`, `delta_display`, `pct_change`                                      |
| `explain_change`      | dates/location, `dimension?` (default `store`)                                   | Net-sales vs prior contributors, `unexplained_remainder(_display)`                                  |
| `list_context_events` | dates/location                                                                   | Holidays, company events, promotions, weather by store, interpretation note                         |
| `search_news`         | `query` (required), optional dates                                               | Up to 5 semantic matches; omit dates → corpus `DATA_START`…`DATA_END`                               |

**Scope merge:** `scope === 'all'` drops page filters unless the tool resolves a place. `scope === 'page'` merges overrides onto page filters.

## Semantic metrics

`src/lib/metrics.ts` - shared by dashboard and tools.

| Name        | Label               | Definition                                                                                              |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------- |
| `net_sales` | Net sales           | `SUM(store_day_metrics.net_sales)` paise for paid days; with `productId`, `SUM(order_items.line_total)` |
| `units`     | Units               | `SUM(units)` or `SUM(order_items.qty)` with product                                                     |
| `aov`       | Average order value | `net_sales / order_count` (integer paise); product: line sales / distinct paid orders with that SKU     |

**Filters (`MetricFilters`):** `from`, `to`, optional `storeId`, `regionId`, `productId`, `city` (ILIKE). Paid orders only.

**Exports:** `getMetric`, `seriesByDay`, `breakdown`, `kpiBundle`, `METRIC_DEFS`.

## Gates (fixed texts)

| Gate         | When                                                                   | Reply                                                                         |
| ------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Topic refuse | Out of scope                                                           | `SCOPE_REFUSAL_TEXT` - sales/diagnostics only; no personas / weather-as-topic |
| Soft refuse  | `metric === 'unknown'`                                                 | `UNKNOWN_METRIC_TEXT` - Net sales, Units, or AOV only                         |
| Clarify      | diagnose/compare with no place and no window (after page place inject) | Asks for place and date window                                                |

Topic / slot **fail-open** only on provider codes `timeout` and `transient` (`isFailOpenCode`). Auth/quota hard-stop.

## Environment variables

| Variable                       | Default                               | Role                                                                 |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                 | `postgres://localhost:5432/northstar` | Postgres                                                             |
| `GEMINI_API_KEY`               | (required for LLM)                    | Chat + embeddings; copied to `GOOGLE_GENERATIVE_AI_API_KEY` if unset |
| `GOOGLE_GENERATIVE_AI_API_KEY` | -                                     | SDK alias                                                            |
| `GEMINI_MODEL`                 | `gemini-3.1-flash-lite`               | Analyst / gate model                                                 |
| `TOPIC_GUARD_TIMEOUT_MS`       | `8000`                                | Topic `generateObject`                                               |
| `SLOT_FILL_TIMEOUT_MS`         | `8000`                                | Slot `generateObject`                                                |
| `CHAT_ANALYST_TIMEOUT_MS`      | `45000`                               | Analyst abort cap                                                    |
| `CHAT_ROUTE_BUDGET_MS`         | `58000`                               | Soft ceiling for whole request                                       |
| `EVAL_AGENT_TIMEOUT_MS`        | `90000`                               | Eval agent abort                                                     |
| `EVAL_CASE_PACE_MS`            | `4000`                                | Delay between eval cases                                             |
| `OPENWEATHER_API_KEY`          | -                                     | `pnpm weather:sync`                                                  |
| `OPENROUTER_API_KEY`           | -                                     | Optional embedding fallback                                          |
| `LANGFUSE_*`                   | host `https://cloud.langfuse.com`     | Optional trace export                                                |
| `SENTRY_DSN`                   | -                                     | Optional; current capture logs to console                            |

## Scripts

| Script                         | Action                                  |
| ------------------------------ | --------------------------------------- |
| `pnpm db:push`                 | Extensions + drizzle push               |
| `pnpm db:seed` / `db:reset`    | Wipe and reload seed                    |
| `pnpm weather:sync`            | OpenWeather upsert into `weather_daily` |
| `pnpm eval`                    | Eval runner                             |
| `pnpm test`                    | Unit tests                              |
| `pnpm dev` / `build` / `start` | Next.js                                 |

## Related

- [How to diagnose sales drops](howto-diagnose-sales.md)
- [How to run evals](howto-run-evals.md)
- [Explanation: Design decisions](explanation-design-decisions.md)
- [Architecture diagrams](../diagrams/ARCHITECTURE.md)
