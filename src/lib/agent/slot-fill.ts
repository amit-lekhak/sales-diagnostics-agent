import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ChatScope, PageContext } from '../page-context';
import {
  classifyProviderError,
  isFailOpenCode,
  type ClassifiedError,
} from './provider-errors';
import { addSpan } from './tracer';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
const SLOT_TIMEOUT_MS = Number(process.env.SLOT_FILL_TIMEOUT_MS ?? 15_000);

const rawSlotSchema = z.object({
  intent: z.enum(['kpi', 'breakdown', 'compare', 'diagnose', 'context', 'other']),
  place: z.string().nullable(),
  window: z.string().nullable(),
  metric: z.enum(['net_sales', 'units', 'aov', 'unknown']).nullable(),
  need_clarify: z.boolean(),
  clarify_question: z.string().nullable(),
  reason: z.string(),
});

export const UNKNOWN_METRIC_TEXT =
  'I can report Net sales, Units, or AOV. Ask about one of those metrics for a place and date window.';

export const CLARIFY_PLACE_WINDOW_TEXT =
  'Which place (store, city, or region) and date window should I use for that diagnosis?';

export type SlotIntent =
  'kpi' | 'breakdown' | 'compare' | 'diagnose' | 'context' | 'other';

export type SlotMetric = 'net_sales' | 'units' | 'aov' | 'unknown' | null;

export type FilledSlots = {
  intent: SlotIntent;
  place: string | null;
  window: string | null;
  metric: SlotMetric;
  placeSource: 'user' | 'page' | 'default' | null;
  windowSource: 'user' | 'page' | 'default' | null;
  defaultsApplied: string[];
  reason: string;
};

export type SlotFillResult =
  | { action: 'clarify'; text: string; slots: FilledSlots }
  | { action: 'soft_refuse'; text: string; slots: FilledSlots }
  | { action: 'ready'; slots: FilledSlots }
  | { action: 'fail_open'; slots: null; reason: string }
  | { action: 'provider_error'; slots: null; classified: ClassifiedError };

const SLOT_SYSTEM = `You extract structured slots for Northstar Mart's sales diagnostics chat.
Do not answer the user. Only fill the schema.

intent:
- kpi: ask for a metric value
- breakdown: ranking or split by store/region/sku
- compare: compare two periods or places
- diagnose: why sales moved / drop / spike explanation
- context: holidays, company events, weather overlap, news only
- other: unclear but still sales-related

place: store, city, or region as the user (or prior turn) named it; null if none.
window: date range or relative phrase ("last month", "July 2026"); null if none.
metric: net_sales, units, aov when clear; unknown if they ask for an unsupported metric (conversion rate, margin, etc.); null if not specified.
need_clarify: true only when diagnose/compare lacks both place and window and prior turns do not supply them.
clarify_question: one short clarifying question when need_clarify is true; else null.
reason: short.

Inherit place/window from recent turns when the current message is a short follow-up.`;

function pageHasPlace(scope: ChatScope, page: PageContext): boolean {
  return scope === 'page' && (page.storeId != null || page.regionId != null);
}

function applyDeterministicRules(input: {
  raw: z.infer<typeof rawSlotSchema>;
  scope: ChatScope;
  page: PageContext;
  defaultFrom: string;
  defaultTo: string;
}): SlotFillResult {
  const { raw, scope, page, defaultFrom, defaultTo } = input;
  const defaultsApplied: string[] = [];

  let place = raw.place?.trim() || null;
  let window = raw.window?.trim() || null;
  let placeSource: FilledSlots['placeSource'] = place ? 'user' : null;
  let windowSource: FilledSlots['windowSource'] = window ? 'user' : null;

  if (!place && pageHasPlace(scope, page)) {
    place =
      page.storeId != null
        ? `page store #${page.storeId}`
        : `page region #${page.regionId}`;
    placeSource = 'page';
    defaultsApplied.push(`place from page filter (${place})`);
  }

  const slotsBase = (): FilledSlots => ({
    intent: raw.intent,
    place,
    window,
    metric: raw.metric,
    placeSource,
    windowSource,
    defaultsApplied: [...defaultsApplied],
    reason: raw.reason,
  });

  if (raw.metric === 'unknown') {
    return { action: 'soft_refuse', text: UNKNOWN_METRIC_TEXT, slots: slotsBase() };
  }

  const needsBoth = raw.intent === 'diagnose' || raw.intent === 'compare';

  if (needsBoth && !place && !window) {
    const text = raw.clarify_question?.trim() || CLARIFY_PLACE_WINDOW_TEXT;
    return {
      action: 'clarify',
      text,
      slots: { ...slotsBase(), defaultsApplied },
    };
  }

  if (needsBoth) {
    if (!place) {
      place = 'all stores';
      placeSource = 'default';
      defaultsApplied.push('place defaulted to all stores (user did not name a place)');
    }
    if (!window) {
      window = `${defaultFrom} to ${defaultTo}`;
      windowSource = 'default';
      defaultsApplied.push(
        `window defaulted to ${defaultFrom} → ${defaultTo} (user did not name a window)`,
      );
    }
  } else {
    // kpi / breakdown / context / other: never force clarify for missing place
    if (!window) {
      window = `${defaultFrom} to ${defaultTo}`;
      windowSource = 'default';
      defaultsApplied.push(`window defaulted to ${defaultFrom} → ${defaultTo}`);
    }
    if (!place) {
      place = 'all stores';
      placeSource = 'default';
      defaultsApplied.push('place defaulted to all stores');
    }
  }

  return {
    action: 'ready',
    slots: {
      intent: raw.intent,
      place,
      window,
      metric: raw.metric,
      placeSource,
      windowSource,
      defaultsApplied,
      reason: raw.reason,
    },
  };
}

export async function fillSlots(input: {
  message: string;
  runId: string;
  recentTurns?: { role: string; content: string }[];
  scope: ChatScope;
  page: PageContext;
  defaultFrom: string;
  defaultTo: string;
}): Promise<SlotFillResult> {
  const startedAt = new Date();
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  const historyBlock =
    input.recentTurns && input.recentTurns.length
      ? input.recentTurns.map((m) => `${m.role}: ${m.content}`).join('\n')
      : '(none)';

  const prompt = `Recent turns:\n${historyBlock}\n\nCurrent user message:\n${input.message}`;

  try {
    const result = await generateObject({
      model: google(MODEL),
      schema: rawSlotSchema,
      schemaName: 'slot_fill',
      schemaDescription: 'Extracted sales diagnostics slots for the current user turn',
      system: SLOT_SYSTEM,
      prompt,
      abortSignal: AbortSignal.timeout(SLOT_TIMEOUT_MS),
    });

    const decided = applyDeterministicRules({
      raw: result.object,
      scope: input.scope,
      page: input.page,
      defaultFrom: input.defaultFrom,
      defaultTo: input.defaultTo,
    });

    await addSpan({
      runId: input.runId,
      kind: 'guard',
      name: 'slot_filler',
      startedAt,
      endedAt: new Date(),
      payloadIn: { message: input.message, historyTurns: input.recentTurns?.length ?? 0 },
      payloadOut: decided,
      tokenCount: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
    });

    return decided;
  } catch (err) {
    const classified = classifyProviderError(err);
    if (isFailOpenCode(classified.code)) {
      await addSpan({
        runId: input.runId,
        kind: 'guard',
        name: 'slot_filler',
        startedAt,
        endedAt: new Date(),
        payloadIn: { message: input.message },
        payloadOut: { action: 'fail_open', failedOpen: true, code: classified.code },
        error: classified.raw,
      });
      return { action: 'fail_open', slots: null, reason: classified.raw };
    }
    await addSpan({
      runId: input.runId,
      kind: 'guard',
      name: 'slot_filler',
      startedAt,
      endedAt: new Date(),
      payloadIn: { message: input.message },
      payloadOut: { action: 'provider_error', code: classified.code },
      error: classified.raw,
    });
    return { action: 'provider_error', slots: null, classified };
  }
}

/** Compact block for the analyst system prompt. */
export function formatSlotsForPrompt(slots: FilledSlots): string {
  const lines = [
    'Filled slots for this turn (trust these; state any applied defaults in your answer):',
    `- intent: ${slots.intent}`,
    `- place: ${slots.place ?? 'none'} (${slots.placeSource ?? 'n/a'})`,
    `- window: ${slots.window ?? 'none'} (${slots.windowSource ?? 'n/a'})`,
    `- metric: ${slots.metric ?? 'not specified'}`,
  ];
  if (slots.defaultsApplied.length) {
    lines.push(`- defaults applied: ${slots.defaultsApplied.join('; ')}`);
  }
  lines.push(
    '- Do not silently diagnose or compare company-wide without naming the place/window you used.',
  );
  return lines.join('\n');
}
