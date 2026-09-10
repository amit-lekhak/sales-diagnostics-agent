# Design decisions: grounding, gates, and causation

Why the sales diagnostics agent is shaped the way it is - not a full API catalog ([see reference](reference-runtime.md)).

## The problem

Retail chatbots that “know” sales numbers invent them. Operators then argue with the model instead of the ledger. The same systems often treat weather or news as causal stories, which trains trust in the wrong place.

Northstar Mart needs answers that:

1. Match dashboard KPIs for the same filters
2. Stay in a sales-diagnostics role
3. Separate correlation (rain overlap) from cause (stockout, promo cliff)

## The approach

```
User message
    │
    ▼
Topic classifier (Gemini, no tools)
    │ refuse ──► fixed SCOPE_REFUSAL_TEXT
    │ fail-open (timeout/transient only)
    ▼
Slot filler (structured)
    │ clarify / unknown metric ──► fixed text, no tools
    │ fail-open (timeout/transient; vague diagnose may still clarify)
    ▼
Analyst Gemini + 6 Zod tools → Postgres semantic layer
    │
    ▼
Quote tool display · cite spans · optional summarize
```

**Single analyst, not a multi-agent crew.** One tool loop (`stepCountIs(8)`) keeps latency and failure modes understandable. Guardrails are the topic gate, slot filler, prompt rules, Zod schemas, page scope, and offline eval scorers - not a human approval step.

**One semantic layer.** `src/lib/metrics.ts` feeds Overview cards and `get_metric` / `breakdown` / `compare_periods`. Product filters use `order_items` because `store_day_metrics` has no SKU dimension.

**Seeded stories as eval ground truth.** Cases re-query Postgres after `pnpm db:seed` instead of freezing paise in JSON. That keeps SQL and agent checks honest when seed logic changes.

## Trade-offs

| Choice                                            | Gain                                  | Cost                                                      |
| ------------------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| Fail-open on gate timeout/transient               | Chat stays usable when Gemini blips   | Occasional out-of-scope or vague turn reaches the analyst |
| Fail-closed clarify / unknown metric              | No tool spam on junk intents          | Extra turn for users who omit place/window                |
| Soft rules in prompt, hard structure in Zod + SQL | Model can narrate; numbers stay typed | Prompt drift still possible; evals catch regressions      |
| Weather as overlap only                           | Avoids false causation                | Users who want a weather lecture get refused              |
| Hash embedding fallback                           | Seed works without API keys           | RAG recall evals skip if live run uses Gemini             |

## Alternatives considered

- **Raw SQL from the model** - rejected; every number goes through named tools and the metrics module.
- **Hard-block chat on any gate error** - rejected for transient timeouts; auth/quota still hard-stop.
- **LLM-as-judge evals** - rejected; `evals/score.ts` uses deterministic checks (`numeric_fidelity`, `causation_hygiene`, `remainder_present`, tool recall).
- **Human-in-the-loop before stream** - out of scope for this product surface; ops traces exist for inspection after the fact.

## Related

- Runtime diagrams: [diagrams/ARCHITECTURE.md](../diagrams/ARCHITECTURE.md)
- Using the chat: [How to diagnose sales drops](howto-diagnose-sales.md)
- Locking behavior: [How to run evals](howto-run-evals.md)
