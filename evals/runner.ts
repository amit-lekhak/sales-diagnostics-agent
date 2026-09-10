import './env';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/lib/db';
import { runAgent } from './agent';
import { EVAL_CASES, type EvalCase, type EvalType, type Scenario } from './cases';
import { assertSeeded, loadCatalog, resolvePage } from './catalog';
import { runOracle, type OracleResult } from './oracle';
import { scoreAgent, scoreOracle, type AgentScore, type Check } from './score';

const here = dirname(fileURLToPath(import.meta.url));

if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
}

type Flags = {
  type?: EvalType;
  scenario?: Scenario;
  id?: string;
  skipAgent: boolean;
};

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { skipAgent: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === '--skip-agent') flags.skipAgent = true;
    else if (arg === '--type' && next) {
      flags.type = next as EvalType;
      i++;
    } else if (arg === '--scenario' && next) {
      flags.scenario = next as Scenario;
      i++;
    } else if (arg === '--id' && next) {
      flags.id = next;
      i++;
    }
  }
  return flags;
}

function selectCases(flags: Flags): EvalCase[] {
  return EVAL_CASES.filter((c) => {
    if (flags.id) return c.id === flags.id;
    if (flags.type && c.type !== flags.type) return false;
    if (flags.scenario && c.scenario !== flags.scenario) return false;
    return true;
  });
}

type CaseReport = {
  id: string;
  type: EvalType;
  scenario: Scenario;
  pass: boolean;
  latency_ms: number | null;
  oracle: { ok: boolean; skipped?: boolean; detail: string };
  agent?: AgentScore & { error?: string; text?: string };
  checks: Check[];
};

function rollup(rows: CaseReport[], key: 'type' | 'scenario') {
  const groups = new Map<string, { pass: number; total: number }>();
  for (const row of rows) {
    const k = row[key];
    const g = groups.get(k) ?? { pass: 0, total: 0 };
    g.total += 1;
    if (row.pass) g.pass += 1;
    groups.set(k, g);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([k, v]) => [k, { ...v, rate: v.pass / v.total }]),
  );
}

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function printTable(rows: CaseReport[]) {
  console.log(
    `${pad('id', 28)} ${pad('type', 10)} ${pad('scenario', 18)} ${pad('pass', 6)} ${pad('ms', 7)} detail`,
  );
  for (const row of rows) {
    const fail = row.checks.filter((c) => !c.ok).map((c) => c.name);
    const detail = row.pass ? 'ok' : fail.join(',') || row.oracle.detail;
    console.log(
      `${pad(row.id, 28)} ${pad(row.type, 10)} ${pad(row.scenario, 18)} ${pad(
        row.pass ? 'PASS' : 'FAIL',
        6,
      )} ${pad(String(row.latency_ms ?? '-'), 7)} ${detail}`,
    );
  }
}

function log(msg: string) {
  console.log(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(message: string | undefined): boolean {
  if (!message) return false;
  return /quota|rate[- ]?limit|429|resource.?exhausted/i.test(message);
}

/** Parse "Please retry in 56.005s" style hints; default 60s. */
function retryAfterMs(message: string): number {
  const m = message.match(/retry in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (m) return Math.ceil(Number(m[1]) * 1000) + 1000;
  return 60_000;
}

async function runAgentWithRateLimitRetry(input: {
  question: string;
  scope: EvalCase['scope'];
  page: ReturnType<typeof resolvePage>;
}) {
  let agent = await runAgent(input);
  if (agent.error && isRateLimitError(agent.error)) {
    const wait = retryAfterMs(agent.error);
    log(`rate limited — waiting ${Math.round(wait / 1000)}s then retrying…`);
    await sleep(wait);
    agent = await runAgent(input);
  }
  return agent;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!process.env.GEMINI_API_KEY) {
    flags.skipAgent = true;
    console.warn('GEMINI_API_KEY missing — running oracle layer only (--skip-agent).');
  }

  log('Checking seed data…');
  await assertSeeded();
  const catalog = await loadCatalog();
  const cases = selectCases(flags);
  if (!cases.length) {
    throw new Error('No eval cases matched the given filters.');
  }

  log(
    `Running ${cases.length} case(s)${flags.skipAgent ? ' (oracle only)' : ' (oracle + Gemini)'}. ` +
      'Full suite often takes 3–5 minutes; each case logs as it finishes.',
  );

  const paceMs = Number(process.env.EVAL_CASE_PACE_MS ?? 4000);
  const reports: CaseReport[] = [];
  for (let i = 0; i < cases.length; i++) {
    const cse = cases[i]!;
    const label = `[${i + 1}/${cases.length}] ${cse.id}`;
    process.stdout.write(`${label} oracle… `);
    const page = resolvePage(catalog, cse.page);
    const oracle: OracleResult = await runOracle(catalog, cse);
    const oracleChecks = scoreOracle(cse, oracle);
    let checks = [...oracleChecks];
    let agentScore: CaseReport['agent'];
    let latency: number | null = null;
    let pass = oracleChecks.every((c) => c.ok);

    if (!flags.skipAgent) {
      if (i > 0 && paceMs > 0) await sleep(paceMs);
      process.stdout.write('agent… ');
      const agent = await runAgentWithRateLimitRetry({
        question: cse.question,
        scope: cse.scope,
        page,
      });
      latency = agent.latencyMs;
      const scored = scoreAgent(cse, oracle, agent.text, agent.tools);
      if (agent.error) {
        scored.pass = false;
        scored.checks.push({ name: 'agent_error', ok: false, detail: agent.error });
      }
      agentScore = {
        ...scored,
        error: agent.error,
        text: agent.text.slice(0, 2000),
      };
      checks = [...oracleChecks, ...scored.checks];
      if (agent.error) {
        checks.push({ name: 'agent_error', ok: false, detail: agent.error });
      }
      pass = checks.every((c) => c.ok);
    }

    reports.push({
      id: cse.id,
      type: cse.type,
      scenario: cse.scenario,
      pass,
      latency_ms: latency,
      oracle: {
        ok: oracle.ok,
        skipped: oracle.skipped,
        detail: oracle.detail,
      },
      agent: agentScore,
      checks,
    });

    const fail = checks.filter((c) => !c.ok).map((c) => c.name);
    const ms = latency != null ? ` ${latency}ms` : '';
    log(`${pass ? 'PASS' : 'FAIL'}${ms}${pass ? '' : ` (${fail.join(',')})`}`);
  }

  console.log('');
  printTable(reports);
  const passed = reports.filter((r) => r.pass).length;
  console.log(
    `\n${passed}/${reports.length} passed  by type`,
    rollup(reports, 'type'),
    ' by scenario',
    rollup(reports, 'scenario'),
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(here, 'results');
  await mkdir(outDir, { recursive: true });
  const outPath = resolve(outDir, `${stamp}.json`);
  await writeFile(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        skipAgent: flags.skipAgent,
        passed,
        total: reports.length,
        byType: rollup(reports, 'type'),
        byScenario: rollup(reports, 'scenario'),
        cases: reports,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outPath}`);

  await sql.end({ timeout: 5 });
  if (passed < reports.length) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // ignore
  }
  process.exit(1);
});
