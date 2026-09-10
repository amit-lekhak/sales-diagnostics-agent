import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyDeterministicRules,
  clarifyOnFailOpen,
  CLARIFY_PLACE_WINDOW_TEXT,
  UNKNOWN_METRIC_TEXT,
} from './slot-fill';
import { patternHitsAsAffirmation } from '../../../evals/score';
import {
  DATA_END,
  defaultRange,
  lastMonth,
  priorPeriod,
  rangeForPeriod,
  yoyPeriod,
} from '../dates';

describe('applyDeterministicRules', () => {
  const page = { page: 'overview' as const, pathname: '/' };
  const range = defaultRange();

  it('clarifies diagnose with neither place nor window', () => {
    const result = applyDeterministicRules({
      raw: {
        intent: 'diagnose',
        place: null,
        window: null,
        metric: null,
        need_clarify: true,
        clarify_question: null,
        reason: 'vague',
      },
      scope: 'all',
      page,
      defaultFrom: range.from,
      defaultTo: range.to,
    });
    assert.equal(result.action, 'clarify');
    if (result.action === 'clarify') {
      assert.equal(result.text, CLARIFY_PLACE_WINDOW_TEXT);
    }
  });

  it('defaults window when diagnose has place only', () => {
    const result = applyDeterministicRules({
      raw: {
        intent: 'diagnose',
        place: 'Mumbai',
        window: null,
        metric: null,
        need_clarify: false,
        clarify_question: null,
        reason: 'place only',
      },
      scope: 'all',
      page,
      defaultFrom: range.from,
      defaultTo: range.to,
    });
    assert.equal(result.action, 'ready');
    if (result.action === 'ready') {
      assert.equal(result.slots.place, 'Mumbai');
      assert.equal(result.slots.window, `${range.from} to ${range.to}`);
      assert.equal(result.slots.windowSource, 'default');
    }
  });

  it('soft-refuses unknown metrics', () => {
    const result = applyDeterministicRules({
      raw: {
        intent: 'kpi',
        place: null,
        window: 'last month',
        metric: 'unknown',
        need_clarify: false,
        clarify_question: null,
        reason: 'conversion',
      },
      scope: 'all',
      page,
      defaultFrom: range.from,
      defaultTo: range.to,
    });
    assert.equal(result.action, 'soft_refuse');
    if (result.action === 'soft_refuse') {
      assert.equal(result.text, UNKNOWN_METRIC_TEXT);
    }
  });

  it('treats product page as place', () => {
    const result = applyDeterministicRules({
      raw: {
        intent: 'diagnose',
        place: null,
        window: null,
        metric: null,
        need_clarify: true,
        clarify_question: null,
        reason: 'vague',
      },
      scope: 'page',
      page: { page: 'products', pathname: '/products', productId: 3 },
      defaultFrom: range.from,
      defaultTo: range.to,
    });
    assert.equal(result.action, 'ready');
    if (result.action === 'ready') {
      assert.match(result.slots.place ?? '', /product #3/);
    }
  });
});

describe('clarifyOnFailOpen', () => {
  it('clarifies vague diagnose without place/window', () => {
    const hit = clarifyOnFailOpen({
      message: 'Why did sales drop?',
      scope: 'all',
      page: { page: 'overview', pathname: '/' },
    });
    assert.ok(hit);
    assert.equal(hit?.text, CLARIFY_PLACE_WINDOW_TEXT);
  });

  it('does not clarify when place is named', () => {
    const hit = clarifyOnFailOpen({
      message: 'Why did sales drop in Mumbai?',
      scope: 'all',
      page: { page: 'overview', pathname: '/' },
    });
    assert.equal(hit, null);
  });
});

describe('patternHitsAsAffirmation', () => {
  it('passes denial of rain causation', () => {
    assert.equal(
      patternHitsAsAffirmation(
        'I cannot confirm that rain caused the drop; rainfall overlapped.',
        'rain caused',
      ),
      false,
    );
  });

  it('fails affirmative rain causation', () => {
    assert.equal(
      patternHitsAsAffirmation('Yes, rain caused the Mumbai drop.', 'rain caused'),
      true,
    );
  });
});

describe('date helpers', () => {
  it('lastMonth is August 2026 relative to DATA_END', () => {
    const m = lastMonth(DATA_END);
    assert.equal(m.from, '2026-08-01');
    assert.equal(m.to, '2026-08-31');
  });

  it('priorPeriod keeps equal length', () => {
    const p = priorPeriod({ from: '2026-07-01', to: '2026-07-31' });
    assert.equal(p.from, '2026-05-31');
    assert.equal(p.to, '2026-06-30');
  });

  it('rangeForPeriod page is a no-op', () => {
    assert.equal(rangeForPeriod('page'), null);
  });

  it('yoyPeriod shifts year', () => {
    const y = yoyPeriod({ from: '2025-10-20', to: '2025-10-26' });
    assert.equal(y.from, '2024-10-20');
    assert.equal(y.to, '2024-10-26');
  });
});
