# Sales diagnostics agent — architecture

Gemini analyst via the Vercel AI SDK tool loop (max 8 steps), with a pre-analyst Gemini topic classifier (allow/refuse) and a structured slot filler (clarify / soft-refuse / ready). Both gates fail-open on error. No multi-agent handoffs and no human-approval gate; guardrails are the topic gate, slot filler, prompt rules, Zod tool schemas, and offline eval scorers.

Docs: [tutorial](../docs/tutorial-getting-started.md) · [runtime reference](../docs/reference-runtime.md) · [design decisions](../docs/explanation-design-decisions.md) · [docs index](../docs/README.md)

## 1. Runtime workflow

```mermaid
flowchart TD
  User[ChatWidget]
  API["POST /api/chat"]
  Run[createRun agent_runs]
  Guard["classifyTopic Gemini no tools"]
  Refuse[SCOPE_REFUSAL_TEXT JSON]
  Slots["fillSlots Gemini structured"]
  Clarify[clarify or soft-refuse JSON]
  Ctx[loadConversationContext]
  Dim[loadDimensions]
  Prompt[systemPrompt soft rules plus slots]
  Loop["Gemini streamText stopWhen stepCountIs 8"]

  User --> API
  API --> Run
  Run --> Guard
  Guard -->|allowed false| Refuse
  Guard -->|allowed true or fail-open| Ctx
  Ctx --> Slots
  Slots -->|need_clarify or unknown metric| Clarify
  Slots -->|ready or fail-open| Dim
  Dim --> Prompt
  Prompt --> Loop

  subgraph guardrails [Guardrails not a human gate]
    TopicLLM[Topic classifier Gemini structured]
    SlotLLM[Slot filler Gemini structured]
    ClarifyRules[Diagnose needs place plus window; unknown metric soft-refuse]
    FailOpen[Fail-open on classifier or slot error]
    Zod[Zod tool input schemas]
    Scope[ToolRuntime scope and page filters]
    PromptRules[Prompt: quote display no invented numbers]
  end

  Guard -.-> TopicLLM
  Guard -.-> FailOpen
  Slots -.-> SlotLLM
  Slots -.-> ClarifyRules
  Slots -.-> FailOpen
  Prompt -.-> PromptRules
  Loop --> Zod
  Loop --> Scope

  subgraph tools [Tools fan-out]
    T1[get_metric]
    T2[breakdown]
    T3[compare_periods]
    T4[explain_change]
    T5[list_context_events]
    T6[search_news]
  end

  Loop --> tools
  tools --> PG[(Postgres semantic layer)]
  T1 -->|"productId via order_items"| PG
  T5 --> Promo[promotions and region-scoped holidays]
  T6 --> Emb[Embeddings pgvector]
  Emb --> PG

  tools --> Spans[addSpan agent_spans]
  Guard --> Spans
  Slots --> Spans
  Loop --> SSE[SSE meta delta done]
  SSE --> Persist[Persist assistant message]
  Persist --> Finish[finishRun]
  Finish --> Sum[maybeSummarize]
  Spans --> Cite[citationsFromSpans]
  Cite --> Ops["/ops traces UI"]
```

Chat UI posts to `/api/chat`, which creates a traced run, then classifies the topic with a small Gemini call (no tools). Out-of-scope messages get a fixed refusal JSON response. In-scope (or classifier fail-open) loads conversation context and runs the slot filler: incomplete diagnose/compare (no place and no window, and no page store/region filter) or an unknown metric short-circuit as clarify/soft-refuse JSON with no tools. Ready (or slot fail-open) builds the system prompt with filled slots and runs the analyst Gemini with six Postgres-backed tools. Soft rules live in the prompt; hard structure is Zod + page scope plus the topic and slot gates. Spans feed citations and the ops UI; there is no approval step before the reply streams.

## 2. Evals pipeline

```mermaid
flowchart TD
  Seed[Seeded Postgres]
  Cases[EVAL_CASES sql and semantic]
  Runner["pnpm eval evals/runner.ts"]
  Oracle[runOracle same tools no LLM]
  Agent["runAgent topic then slots then Gemini"]
  ScoreO[scoreOracle]
  ScoreA[scoreAgent]

  Seed --> Cases
  Cases --> Runner
  Runner --> Oracle
  Runner --> Agent
  Oracle --> ScoreO
  Agent --> ScoreA

  subgraph judges [Deterministic judges score.ts]
    TR[tool_recall / tool_precision]
    NF[numeric_fidelity / oracle_quoted]
    CH[causation_hygiene / remainder_present]
    RR[retrieval recall at 5]
    PO[param_ok]
  end

  ScoreO --> judges
  ScoreA --> judges
  judges --> Report["JSON report evals/results"]
```

Seeded DB is ground truth. Each case runs an oracle (deterministic tools) and optionally the live agent; `runAgent` applies the same topic guard then slot filler before the analyst. `scope_guard` cases cover refuse (storyteller/weather) and allow (rain overlapping a sales drop). `slot_fill` cases cover vague diagnose clarify (no tools), KPI with last month still answering, and unknown-metric soft refuse. Scorers are rule-based, not LLM-as-judge. Flags: `--skip-agent`, `--type`, `--scenario`, `--id`.

## 3. Component map

```mermaid
flowchart LR
  Route["src/app/api/chat/route.ts"]
  TopicGuard["src/lib/agent/topic-guard.ts"]
  SlotFill["src/lib/agent/slot-fill.ts"]
  AiTools["src/lib/agent/ai-tools.ts"]
  Tools["src/lib/agent/tools.ts"]
  Prompts["src/lib/agent/prompts.ts"]
  Tracer["src/lib/agent/tracer.ts"]
  Metrics["src/lib/metrics.ts"]
  EvalRunner["evals/runner.ts"]
  EvalAgent["evals/agent.ts"]
  EvalOracle["evals/oracle.ts"]
  EvalScore["evals/score.ts"]

  Route --> TopicGuard
  Route --> SlotFill
  Route --> Prompts
  Route --> AiTools
  Route --> Tracer
  TopicGuard --> Tracer
  SlotFill --> Tracer
  AiTools --> Tools
  Tools --> Metrics
  Tools --> Tracer
  EvalRunner --> EvalOracle
  EvalRunner --> EvalAgent
  EvalRunner --> EvalScore
  EvalAgent --> TopicGuard
  EvalAgent --> SlotFill
  EvalAgent --> AiTools
  EvalOracle --> Tools
```

Runtime and evals share the same topic guard, slot filler, tool implementations, and metric SQL layer; the eval runner swaps in oracle vs agent and scores both offline.
