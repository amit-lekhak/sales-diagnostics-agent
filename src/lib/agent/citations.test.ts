import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { citationsFromSpans, type TraceSpan } from './citations';

describe('citationsFromSpans', () => {
  it('keeps only SQL evidence from a mixed screenshot-shaped run', () => {
    const spans: TraceSpan[] = [
      {
        kind: 'llm',
        name: 'gemini-3.1-flash-lite',
        error: null,
        output: { chars: 120, inputTokens: 10, outputTokens: 20 },
      },
      {
        kind: 'guard',
        name: 'topic_classifier',
        error: 'timeout',
        output: { allowed: true, failedOpen: true, code: 'timeout' },
      },
      {
        kind: 'guard',
        name: 'slot_filler',
        error: null,
        output: { action: 'ready', intent: 'kpi' },
      },
      {
        kind: 'tool',
        name: 'get_metric',
        error: null,
        output: {
          metric: 'net_sales',
          label: 'Net sales',
          display: '₹27,11,426',
          value: 271142600,
          filters: { from: '2026-08-01', to: '2026-08-31' },
        },
      },
    ];

    const lines = citationsFromSpans(spans);
    assert.deepEqual(lines, ['SQL Net sales = ₹27,11,426 (2026-08-01 · 2026-08-31)']);
  });

  it('omits tool spans that failed', () => {
    const spans: TraceSpan[] = [
      {
        kind: 'tool',
        name: 'get_metric',
        error: 'db unavailable',
        output: null,
      },
      {
        kind: 'tool',
        name: 'breakdown',
        error: null,
        output: {
          dimension: 'store',
          rows: [{ label: 'Andheri', net_sales: 10000 }],
        },
      },
    ];

    const lines = citationsFromSpans(spans);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^SQL breakdown by store:/);
  });

  it('cites search_news and list_context_events', () => {
    const spans: TraceSpan[] = [
      {
        kind: 'tool',
        name: 'list_context_events',
        error: null,
        output: {
          holidays: [{ name: 'Diwali' }],
          company_events: [{ title: 'Stockout' }],
          promotions: [],
          weather_by_store: [{ store_id: 1 }, { store_id: 2 }],
        },
      },
      {
        kind: 'tool',
        name: 'search_news',
        error: null,
        output: {
          matches: [{ title: 'Port congestion delays' }, { title: 'Monsoon update' }],
        },
      },
      {
        kind: 'summarize',
        name: 'conversation_summary',
        error: null,
        output: null,
      },
    ];

    const lines = citationsFromSpans(spans);
    assert.deepEqual(lines, [
      'Stored context: 1 holidays, 1 company events, 0 promotions, 2 weather store rows (correlation, not cause)',
      'News (pgvector): Port congestion delays; Monsoon update',
    ]);
  });

  it('skips guard/llm/embed without emitting kind/name fallbacks', () => {
    const spans: TraceSpan[] = [
      { kind: 'llm', name: 'gemini-3.1-flash-lite', error: null, output: null },
      { kind: 'embed', name: 'gemini-embedding-001', error: null, output: null },
      { kind: 'guard', name: 'slot_filler', error: null, output: { action: 'ready' } },
    ];
    assert.deepEqual(citationsFromSpans(spans), []);
  });
});
