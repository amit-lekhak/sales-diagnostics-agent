# How to run evals

Score the metric SQL layer (oracle) and optionally the live Gemini agent against seeded Postgres. Cases do not freeze paise - re-seed, then evaluate.

## Prerequisites

- Postgres populated with seed data
- For agent cases: `GEMINI_API_KEY` (same embedding provider as seed for RAG recall cases)

## Steps

1. Re-seed so ground truth matches the suite:

   ```bash
   pnpm db:seed
   ```

2. Run oracle-only (no Gemini agent calls):

   ```bash
   pnpm eval -- --skip-agent
   ```

3. Or run the full suite (oracle + agent; often 3–5 minutes):

   ```bash
   pnpm eval
   ```

4. Narrow the run when debugging:

   ```bash
   pnpm eval -- --type sql
   pnpm eval -- --type semantic
   pnpm eval -- --scenario mumbai_july
   pnpm eval -- --id sql-net-sales-last-month
   ```

## Flags

| Flag                   | Effect                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--skip-agent`         | Score oracle / retrieval only                                                                                         |
| `--type sql\|semantic` | Filter by case type                                                                                                   |
| `--scenario <name>`    | e.g. `kpi`, `page_scope`, `mumbai_july`, `pune_promo`, `delhi_diwali`, `south_competitor`, `scope_guard`, `slot_fill` |
| `--id <case-id>`       | Single case                                                                                                           |

Env: `EVAL_AGENT_TIMEOUT_MS` (default `90000`), `EVAL_CASE_PACE_MS` (default `4000`). Missing `GEMINI_API_KEY` forces oracle-only behavior.

## Verification

- Console prints each case as it finishes (`PASS` / fail detail).
- JSON reports land in `evals/results/`.
- Oracle checks prove SQL tools match seed; agent checks cover tool use, numeric fidelity, causation hygiene, and (when embeddings match) news recall.

Unit tests (mostly no Gemini):

```bash
pnpm test
```

## Troubleshooting

| Symptom                         | Fix                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| Seed assert fails               | Run `pnpm db:seed`                                                                        |
| RAG recall skipped with warning | Seed and eval must use the same embedding provider (Gemini vs hash fallback)              |
| Agent timeouts                  | Raise `EVAL_AGENT_TIMEOUT_MS` or run `--skip-agent` / a single `--id`                     |
| Rate limits                     | Runner may wait-and-retry once on rpm/tpm; slow the suite with higher `EVAL_CASE_PACE_MS` |

Related: [Reference: Runtime](reference-runtime.md), [Explanation: Design decisions](explanation-design-decisions.md).
