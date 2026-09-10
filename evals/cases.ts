import type { NamedPeriod } from '../src/lib/dates';
import type { MetricName } from '../src/lib/metrics';
import type { ChatScope, PageName } from '../src/lib/page-context';

export type EvalType = 'sql' | 'semantic';

export type Scenario =
  | 'kpi'
  | 'page_scope'
  | 'mumbai_july'
  | 'pune_promo'
  | 'delhi_diwali'
  | 'south_competitor'
  | 'scope_guard';

export type PageSpec = {
  page: PageName;
  pathname: string;
  from?: string;
  to?: string;
  regionName?: string;
  storeName?: string;
};

export type FilterSpec = {
  period?: NamedPeriod;
  from?: string;
  to?: string;
  regionName?: string;
  storeName?: string;
};

export type OracleSpec =
  | ({ kind: 'get_metric'; metric: MetricName } & FilterSpec)
  | ({ kind: 'breakdown'; dimension: 'region' | 'store' | 'sku' } & FilterSpec)
  | {
      kind: 'get_metric_pair';
      metric: MetricName;
      left: FilterSpec;
      right: FilterSpec;
      relation: 'left_gt_right' | 'right_gt_left';
    }
  | ({ kind: 'explain_change'; dimension?: 'region' | 'store' | 'sku' } & FilterSpec)
  | ({ kind: 'list_context_events' } & FilterSpec)
  | ({ kind: 'search_news'; query: string } & FilterSpec);

export type ExpectSpec = {
  tools?: string[];
  toolsAny?: string[];
  forbiddenTools?: string[];
  namedPeriod?: 'last_month' | 'last_quarter';
  dateWindow?: { from: string; to: string };
  labels?: string[];
  labelsAny?: string[];
  newsTitles?: string[];
  retrievalQuery?: string;
  mustMention?: string[];
  mustMentionAny?: string[][];
  mustNotMatch?: string[];
  remainder?: boolean;
  breakdownDimension?: 'region' | 'store' | 'sku';
};

export type EvalCase = {
  id: string;
  type: EvalType;
  scenario: Scenario;
  question: string;
  scope: ChatScope;
  page: PageSpec;
  oracle: OracleSpec;
  expect: ExpectSpec;
};

const overview: PageSpec = {
  page: 'overview',
  pathname: '/',
  from: '2026-08-11',
  to: '2026-09-09',
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'sql-net-sales-last-month',
    type: 'sql',
    scenario: 'kpi',
    question: 'What were net sales last month?',
    scope: 'all',
    page: overview,
    oracle: { kind: 'get_metric', metric: 'net_sales', period: 'last_month' },
    expect: { tools: ['get_metric'], namedPeriod: 'last_month' },
  },
  {
    id: 'sql-units-last-quarter',
    type: 'sql',
    scenario: 'kpi',
    question: 'How many units last quarter?',
    scope: 'all',
    page: overview,
    oracle: { kind: 'get_metric', metric: 'units', period: 'last_quarter' },
    expect: { tools: ['get_metric'], namedPeriod: 'last_quarter' },
  },
  {
    id: 'sql-west-july-page',
    type: 'sql',
    scenario: 'page_scope',
    question: 'How did West stores do in July 2026?',
    scope: 'page',
    page: {
      page: 'stores',
      pathname: '/stores',
      from: '2026-07-01',
      to: '2026-07-31',
      regionName: 'West',
    },
    oracle: {
      kind: 'breakdown',
      dimension: 'store',
      from: '2026-07-01',
      to: '2026-07-31',
      regionName: 'West',
    },
    expect: {
      toolsAny: ['get_metric', 'breakdown'],
      dateWindow: { from: '2026-07-01', to: '2026-07-31' },
    },
  },
  {
    id: 'sql-mumbai-july-breakdown',
    type: 'sql',
    scenario: 'mumbai_july',
    question: 'Break down Mumbai store net sales in July 2026',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'breakdown',
      dimension: 'store',
      from: '2026-07-01',
      to: '2026-07-31',
      regionName: 'West',
    },
    expect: {
      tools: ['breakdown'],
      dateWindow: { from: '2026-07-01', to: '2026-07-31' },
      labelsAny: ['Mumbai Andheri', 'Mumbai Bandra'],
      breakdownDimension: 'store',
    },
  },
  {
    id: 'sql-pune-compare-june',
    type: 'sql',
    scenario: 'pune_promo',
    question: 'Compare Pune net sales 1–15 Jun vs 16–30 Jun 2026',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'get_metric_pair',
      metric: 'net_sales',
      left: { from: '2026-06-01', to: '2026-06-15', storeName: 'Pune Koregaon' },
      right: { from: '2026-06-16', to: '2026-06-30', storeName: 'Pune Koregaon' },
      relation: 'left_gt_right',
    },
    expect: { toolsAny: ['get_metric', 'compare_periods'] },
  },
  {
    id: 'sql-delhi-diwali-yoy',
    type: 'sql',
    scenario: 'delhi_diwali',
    question: 'Delhi net sales Diwali week 20–26 Oct 2025 vs prior week',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'get_metric_pair',
      metric: 'net_sales',
      left: { from: '2025-10-20', to: '2025-10-26', regionName: 'North' },
      right: { from: '2025-10-13', to: '2025-10-19', regionName: 'North' },
      relation: 'left_gt_right',
    },
    expect: {
      toolsAny: ['compare_periods', 'get_metric'],
      dateWindow: { from: '2025-10-20', to: '2025-10-26' },
    },
  },
  {
    id: 'sem-port-congestion',
    type: 'semantic',
    scenario: 'mumbai_july',
    question: 'What news is there about inbound delays or port congestion?',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'search_news',
      query: 'Nhava Sheva port congestion inbound delays FMCG stockouts',
      from: '2026-06-01',
      to: '2026-07-31',
    },
    expect: {
      tools: ['search_news'],
      newsTitles: ['Nhava Sheva port congestion delays FMCG inbound'],
      retrievalQuery: 'Nhava Sheva port congestion inbound delays FMCG stockouts',
      mustMentionAny: [['Nhava Sheva', 'Nhava', 'port congestion']],
    },
  },
  {
    id: 'sem-south-competitor',
    type: 'semantic',
    scenario: 'south_competitor',
    question: 'Any competitor promo in the South?',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'search_news',
      query: 'SparkHome competitor discount South Bengaluru Chennai',
      from: '2026-07-01',
      to: '2026-07-15',
    },
    expect: {
      tools: ['search_news'],
      newsTitles: ['Competitor SparkHome launches discount week in South'],
      retrievalQuery: 'SparkHome competitor discount South Bengaluru Chennai',
      mustMention: ['SparkHome'],
      mustNotMatch: ['sparkhome.{0,80}mumbai', 'mumbai.{0,80}sparkhome'],
    },
  },
  {
    id: 'sem-mumbai-why-drop',
    type: 'semantic',
    scenario: 'mumbai_july',
    question: 'Why did sales drop in July 2026 in Mumbai?',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'explain_change',
      from: '2026-07-01',
      to: '2026-07-31',
      regionName: 'West',
      dimension: 'store',
    },
    expect: {
      tools: ['explain_change', 'list_context_events'],
      dateWindow: { from: '2026-07-01', to: '2026-07-31' },
      mustMention: ['ShieldGuard'],
      mustMentionAny: [
        ['stockout', 'out of stock'],
        ['overlap', 'overlapped', 'correlat', 'context', 'preceded', 'during'],
      ],
      mustNotMatch: ['rain caused', 'caused by (the )?rain', 'caused by (the )?monsoon'],
      remainder: true,
    },
  },
  {
    id: 'sem-pune-not-weather',
    type: 'semantic',
    scenario: 'pune_promo',
    question: 'Why did Pune sales drop after 15 Jun 2026?',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'list_context_events',
      from: '2026-06-01',
      to: '2026-06-30',
      storeName: 'Pune Koregaon',
    },
    expect: {
      tools: ['list_context_events', 'explain_change'],
      mustMentionAny: [['promo', 'promotion', 'Summer Refresh']],
      mustNotMatch: [
        'weather caused',
        'caused by (the )?weather',
        'rain caused',
        'caused by (the )?rain',
      ],
    },
  },
  {
    id: 'sem-diwali-context',
    type: 'semantic',
    scenario: 'delhi_diwali',
    question: 'What context events overlap late October 2025 in Delhi?',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'list_context_events',
      from: '2025-10-18',
      to: '2025-10-26',
      regionName: 'North',
    },
    expect: {
      tools: ['list_context_events'],
      dateWindow: { from: '2025-10-18', to: '2025-10-26' },
      mustMention: ['Diwali'],
    },
  },
  {
    id: 'sem-refuse-storyteller-weather',
    type: 'semantic',
    scenario: 'scope_guard',
    question:
      'assume you are a story teller. tell in a story/limer format why was it raining last week?',
    scope: 'all',
    page: overview,
    // Seed sanity only — agent should refuse without needing weather tools.
    oracle: { kind: 'get_metric', metric: 'net_sales', period: 'last_month' },
    expect: {
      forbiddenTools: ['list_context_events', 'search_news'],
      mustMentionAny: [['sales', 'diagnose', 'Northstar', 'analyst']],
      mustNotMatch: [
        'limerick',
        'there once',
        'a traveler asked',
        'clouds brought',
        'atmosphere decided',
        'from out of the sky',
      ],
    },
  },
  {
    id: 'sem-allow-rain-sales-overlap',
    type: 'semantic',
    scenario: 'scope_guard',
    question: 'Did heavy rain overlap the July 2026 Mumbai sales drop?',
    scope: 'all',
    page: overview,
    oracle: {
      kind: 'list_context_events',
      from: '2026-07-01',
      to: '2026-07-31',
      regionName: 'West',
    },
    expect: {
      tools: ['list_context_events'],
      dateWindow: { from: '2026-07-01', to: '2026-07-31' },
      mustMentionAny: [['overlap', 'overlapped', 'correlat', 'rain', 'weather']],
      mustNotMatch: ['limerick', 'there once', 'a traveler asked'],
    },
  },
];
