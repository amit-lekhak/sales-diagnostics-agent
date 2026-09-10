# Sales diagnostics agent — architecture

Single Gemini analyst via the Vercel AI SDK tool loop (max 8 steps). No multi-agent handoffs and no human-approval gate; guardrails are prompt rules, Zod tool schemas, and offline eval scorers.

## 1. Runtime workflow

```mermaid
flowchart TD
  User[ChatWidget]
  API["POST /api/chat"]
  Run[createRun agent_runs]
  Ctx[loadConversationContext]
  Dim[loadDimensions]
  Prompt[systemPrompt soft rules]
  Loop["Gemini streamText stopWhen stepCountIs 8"]

  User --> API
  API --> Run
  Run --> Ctx
  Ctx --> Dim
  Dim --> Prompt
  Prompt --> Loop

  subgraph guardrails [Guardrails not a human gate]
    Zod[Zod tool input schemas]
    Scope[ToolRuntime scope and page filters]
    PromptRules[Prompt: quote display no invented numbers]
  end

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
  T6 --> Emb[Embeddings pgvector]
  Emb --> PG

  tools --> Spans[addSpan agent_spans]
  Loop --> SSE[SSE meta delta done]
  SSE --> Persist[Persist assistant message]
  Persist --> Finish[finishRun]
  Finish --> Sum[maybeSummarize]
  Spans --> Cite[citationsFromSpans]
  Cite --> Ops["/ops traces UI"]
```

Chat UI posts to `/api/chat`, which creates a traced run, builds context + system prompt, then runs Gemini with six Postgres-backed tools. Soft rules live in the prompt; hard structure is Zod + page scope. Spans feed citations and the ops UI; there is no approval step before the reply streams.

## 2. Evals pipeline

```mermaid
flowchart TD
  Seed[Seeded Postgres]
  Cases[EVAL_CASES sql and semantic]
  Runner["pnpm eval evals/runner.ts"]
  Oracle[runOracle same tools no LLM]
  Agent[runAgent Gemini generateText]
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

Seeded DB is ground truth. Each case runs an oracle (deterministic tools) and optionally the live agent; scorers are rule-based, not LLM-as-judge. Flags: `--skip-agent`, `--type`, `--scenario`, `--id`.

## 3. Component map

```mermaid
flowchart LR
  Route["src/app/api/chat/route.ts"]
  AiTools["src/lib/agent/ai-tools.ts"]
  Tools["src/lib/agent/tools.ts"]
  Prompts["src/lib/agent/prompts.ts"]
  Tracer["src/lib/agent/tracer.ts"]
  Metrics["src/lib/metrics.ts"]
  EvalRunner["evals/runner.ts"]
  EvalAgent["evals/agent.ts"]
  EvalOracle["evals/oracle.ts"]
  EvalScore["evals/score.ts"]

  Route --> Prompts
  Route --> AiTools
  Route --> Tracer
  AiTools --> Tools
  Tools --> Metrics
  Tools --> Tracer
  EvalRunner --> EvalOracle
  EvalRunner --> EvalAgent
  EvalRunner --> EvalScore
  EvalAgent --> AiTools
  EvalOracle --> Tools
```

Runtime and evals share the same tool implementations and metric SQL layer; the eval runner swaps in oracle vs agent and scores both offline.
