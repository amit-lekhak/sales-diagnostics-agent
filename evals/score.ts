import { money } from '../src/lib/format';
import type { EvalCase } from './cases';
import { retrievalRecall, type OracleResult } from './oracle';

export type ToolInvocation = {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
};

export type Check = { name: string; ok: boolean; detail: string };

export type AgentScore = {
  pass: boolean;
  checks: Check[];
  tool_recall: number | null;
  tool_precision: number | null;
  tool_call_count: number;
  numeric_fidelity: boolean | null;
  oracle_quoted: boolean | null;
  retrieval_recall: number | null;
  entity_coverage: boolean | null;
  causation_hygiene: boolean | null;
  remainder_present: boolean | null;
  param_ok: boolean | null;
};

function calledNames(tools: ToolInvocation[]): string[] {
  return tools.map((t) => t.name);
}

function toolRecall(expected: string[], called: string[]): number | null {
  if (!expected.length) return null;
  const set = new Set(called);
  return expected.filter((t) => set.has(t)).length / expected.length;
}

function toolPrecision(expected: string[], called: string[]): number | null {
  if (!called.length) return expected.length === 0 ? 1 : 0;
  if (!expected.length) return null;
  const set = new Set(expected);
  return called.filter((t) => set.has(t)).length / called.length;
}

const MONEY_KEYS = new Set([
  'value',
  'net_sales',
  'delta',
  'current',
  'prior',
  'current_value',
  'prior_value',
  'explained_delta',
  'unexplained_remainder',
]);

function collectDisplays(value: unknown, into: string[]) {
  if (value == null) return;
  if (typeof value === 'string') {
    if (value.includes('₹')) into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDisplays(item, into);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof v === 'string' &&
        (k === 'display' || k.endsWith('_display') || k === 'delta_display')
      ) {
        into.push(v);
      }
      if (typeof v === 'number' && MONEY_KEYS.has(k)) {
        into.push(money(v));
      }
      collectDisplays(v, into);
    }
  }
}

function rupeeCore(s: string): string {
  return s.replace(/[₹\s,]/g, '').replace(/\.\d+$/, '');
}

function coresClose(a: string, b: string) {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= 1;
}

function numericFidelity(text: string, tools: ToolInvocation[]): Check {
  if (/\$|USD/i.test(text)) {
    return { name: 'numeric_fidelity', ok: false, detail: 'answer contains $ or USD' };
  }
  const displays: string[] = [];
  for (const t of tools) collectDisplays(t.output, displays);
  const toolCores = new Set(displays.map(rupeeCore).filter(Boolean));
  const amounts = text.match(/₹\s*[\d,]+(?:\.\d+)?/g) ?? [];
  const missing = amounts.filter(
    (a) => ![...toolCores].some((c) => coresClose(rupeeCore(a), c)),
  );
  if (missing.length) {
    return {
      name: 'numeric_fidelity',
      ok: false,
      detail: `invented amounts: ${missing.join(', ')}`,
    };
  }
  return {
    name: 'numeric_fidelity',
    ok: true,
    detail: `${amounts.length} ₹ amounts grounded`,
  };
}

function oracleQuoted(text: string, displays: string[]): Check | null {
  if (!displays.length) return null;
  const missing = displays.filter((d) => d && !text.includes(d));
  return {
    name: 'oracle_quoted',
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `quoted ${displays.length} oracle display(s)`
        : `missing display: ${missing.slice(0, 3).join(', ')}`,
  };
}

function inputRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return {};
}

function windowsOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string) {
  return aFrom <= bTo && aTo >= bFrom;
}

function paramOk(cse: EvalCase, tools: ToolInvocation[]): Check | null {
  const { namedPeriod, dateWindow, breakdownDimension } = cse.expect;
  if (!namedPeriod && !dateWindow && !breakdownDimension) return null;
  if (!tools.length) {
    return { name: 'param_ok', ok: false, detail: 'no tool calls' };
  }
  const parts: string[] = [];
  let ok = true;
  if (namedPeriod) {
    const hit = tools.some((t) => inputRecord(t.input).period === namedPeriod);
    ok = ok && hit;
    parts.push(hit ? `period=${namedPeriod}` : `expected period=${namedPeriod}`);
  }
  if (dateWindow) {
    const hit = tools.some((t) => {
      const inp = inputRecord(t.input);
      const from = String(inp.from ?? cse.page.from ?? '');
      const to = String(inp.to ?? cse.page.to ?? '');
      return Boolean(
        from && to && windowsOverlap(from, to, dateWindow.from, dateWindow.to),
      );
    });
    ok = ok && hit;
    parts.push(
      hit
        ? `window overlaps ${dateWindow.from}→${dateWindow.to}`
        : `expected dates overlapping ${dateWindow.from}→${dateWindow.to}`,
    );
  }
  if (breakdownDimension) {
    const rows = tools.filter((t) => t.name === 'breakdown');
    const hit = rows.some((t) => inputRecord(t.input).dimension === breakdownDimension);
    ok = ok && hit;
    parts.push(
      hit
        ? `dimension=${breakdownDimension}`
        : `expected breakdown dimension=${breakdownDimension}`,
    );
  }
  return { name: 'param_ok', ok, detail: parts.join('; ') };
}

function newsTitlesFromTools(tools: ToolInvocation[]): string[] {
  const titles: string[] = [];
  for (const t of tools) {
    if (t.name !== 'search_news') continue;
    const out = t.output as { matches?: { title?: string }[] } | null;
    for (const m of out?.matches ?? []) {
      if (m.title) titles.push(m.title);
    }
  }
  return titles;
}

export function scoreOracle(_cse: EvalCase, oracle: OracleResult): Check[] {
  const checks: Check[] = [
    {
      name: 'oracle',
      ok: oracle.ok,
      detail: oracle.skipped ? `skipped: ${oracle.skipReason}` : oracle.detail,
    },
  ];
  if (oracle.skipped) {
    checks[0] = { name: 'oracle', ok: true, detail: oracle.skipReason ?? 'skipped' };
  }
  return checks;
}

export function scoreAgent(
  cse: EvalCase,
  oracle: OracleResult,
  text: string,
  tools: ToolInvocation[],
): AgentScore {
  const checks: Check[] = [];
  const called = calledNames(tools);
  const expected = cse.expect.tools ?? [];
  const recall = toolRecall(expected, called);
  const precision = toolPrecision([...expected, ...(cse.expect.toolsAny ?? [])], called);

  if (expected.length) {
    checks.push({
      name: 'tool_recall',
      ok: recall === 1,
      detail: `expected [${expected.join(', ')}] got [${called.join(', ')}]`,
    });
  }
  if (cse.expect.toolsAny?.length) {
    const hit = cse.expect.toolsAny.some((n) => called.includes(n));
    checks.push({
      name: 'tools_any',
      ok: hit,
      detail: hit
        ? `matched ${cse.expect.toolsAny.filter((n) => called.includes(n)).join(', ')}`
        : `need one of [${cse.expect.toolsAny.join(', ')}]`,
    });
  }
  const forbidden = (cse.expect.forbiddenTools ?? []).filter((n) => called.includes(n));
  if (cse.expect.forbiddenTools?.length) {
    checks.push({
      name: 'forbidden_tools',
      ok: forbidden.length === 0,
      detail: forbidden.length ? `called ${forbidden.join(', ')}` : 'none',
    });
  }

  const param = paramOk(cse, tools);
  if (param) checks.push(param);

  let numeric: boolean | null = null;
  if (cse.type === 'sql') {
    const nf = numericFidelity(text, tools);
    checks.push(nf);
    numeric = nf.ok;
    if (cse.oracle.kind === 'get_metric' || cse.oracle.kind === 'get_metric_pair') {
      const oq = oracleQuoted(text, oracle.displays);
      if (oq) checks.push(oq);
    }
    if (cse.expect.labels?.length) {
      const missing = cse.expect.labels.filter(
        (l) => !text.toLowerCase().includes(l.toLowerCase()),
      );
      checks.push({
        name: 'oracle_quoted',
        ok: missing.length === 0,
        detail:
          missing.length === 0
            ? 'store/region labels present'
            : `missing labels: ${missing.join(', ')}`,
      });
    }
    if (cse.expect.labelsAny?.length) {
      const hit = cse.expect.labelsAny.some((l) =>
        text.toLowerCase().includes(l.toLowerCase()),
      );
      checks.push({
        name: 'oracle_quoted',
        ok: hit,
        detail: hit
          ? 'a required label present'
          : `need one of ${cse.expect.labelsAny.join(', ')}`,
      });
    }
  }

  let retrieval: number | null = null;
  if (cse.expect.newsTitles?.length) {
    const titles = newsTitlesFromTools(tools);
    if (!titles.length && oracle.skipped) {
      checks.push({
        name: 'retrieval_recall@5',
        ok: true,
        detail: 'skipped (fallback embeddings)',
      });
    } else {
      retrieval = retrievalRecall(titles, cse.expect.newsTitles);
      const inAnswer = cse.expect.newsTitles.every((t) =>
        text.toLowerCase().includes(t.toLowerCase().slice(0, 24)),
      );
      const ok = retrieval === 1 || inAnswer;
      checks.push({
        name: 'retrieval_recall@5',
        ok,
        detail:
          retrieval === 1
            ? String(retrieval)
            : inAnswer
              ? 'titles quoted in answer'
              : retrieval == null
                ? 'search_news not called'
                : String(retrieval),
      });
    }
  }

  let entity: boolean | null = null;
  if (cse.expect.mustMention?.length) {
    const missing = cse.expect.mustMention.filter(
      (m) => !text.toLowerCase().includes(m.toLowerCase()),
    );
    entity = missing.length === 0;
    checks.push({
      name: 'entity_coverage',
      ok: entity,
      detail: entity ? 'all required phrases present' : `missing ${missing.join(', ')}`,
    });
  }
  if (cse.expect.mustMentionAny?.length) {
    const missed = cse.expect.mustMentionAny.filter(
      (group) => !group.some((m) => text.toLowerCase().includes(m.toLowerCase())),
    );
    entity = missed.length === 0;
    checks.push({
      name: 'entity_coverage',
      ok: entity,
      detail: entity
        ? 'required phrase groups covered'
        : `missing one of: ${missed.map((g) => g.join('|')).join('; ')}`,
    });
  }

  let hygiene: boolean | null = null;
  if (cse.expect.mustNotMatch?.length) {
    const hits = cse.expect.mustNotMatch.filter((p) => new RegExp(p, 'i').test(text));
    hygiene = hits.length === 0;
    checks.push({
      name: 'causation_hygiene',
      ok: hygiene,
      detail: hygiene ? 'no forbidden claims' : `matched ${hits.join(', ')}`,
    });
  }

  let remainder: boolean | null = null;
  if (cse.expect.remainder) {
    const mentioned = /unexplained|remainder/i.test(text);
    const expl = tools.find((t) => t.name === 'explain_change');
    const rem = (expl?.output as { unexplained_remainder?: number } | undefined)
      ?.unexplained_remainder;
    remainder = mentioned || rem === 0;
    checks.push({
      name: 'remainder_present',
      ok: remainder,
      detail: mentioned
        ? 'unexplained remainder mentioned'
        : rem === 0
          ? 'remainder is 0 in tool output'
          : 'no unexplained remainder',
    });
  }

  return {
    pass: checks.every((c) => c.ok),
    checks,
    tool_recall: recall,
    tool_precision: precision,
    tool_call_count: tools.length,
    numeric_fidelity: numeric,
    oracle_quoted:
      cse.type === 'sql'
        ? (checks.find((c) => c.name === 'oracle_quoted')?.ok ?? null)
        : null,
    retrieval_recall: retrieval,
    entity_coverage: entity,
    causation_hygiene: hygiene,
    remainder_present: remainder,
    param_ok: param?.ok ?? null,
  };
}
