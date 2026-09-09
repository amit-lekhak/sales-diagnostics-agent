import { tool } from 'ai';
import { z } from 'zod';
import type { MetricName } from '../metrics';
import {
  explainChange,
  listContextEvents,
  metricTools,
  searchNews,
  type ToolRuntime,
} from './tools';

const metricEnum = z.enum(['net_sales', 'units', 'aov']);
const periodEnum = z.enum(['page', 'last_month', 'last_quarter']).optional();
const locationFields = {
  storeId: z.number().optional(),
  regionId: z.number().optional(),
  storeName: z
    .string()
    .optional()
    .describe(
      'Store or city name (e.g. "Pune Koregaon", "Pune", "Mumbai", "Delhi"). Prefer this over guessing IDs.',
    ),
  regionName: z.string().optional().describe('Region name: West, North, South, or East.'),
};

export function buildAiTools(rt: ToolRuntime) {
  const mt = metricTools(rt);
  return {
    get_metric: tool({
      description:
        'Return a named metric for a date range. Uses the semantic layer, never raw SQL from the model. Pass period last_month or last_quarter instead of guessing dates. When the user names a store, city, or region, pass storeName or regionName.',
      inputSchema: z.object({
        metric: metricEnum,
        period: periodEnum,
        from: z.string().optional(),
        to: z.string().optional(),
        ...locationFields,
      }),
      execute: async (args) =>
        mt.get_metric({ ...args, metric: args.metric as MetricName }),
    }),
    breakdown: tool({
      description:
        'Break a period of net sales into region, store, or SKU slices. Use dimension=store for store or city questions; sku only when asked about products.',
      inputSchema: z.object({
        dimension: z.enum(['region', 'store', 'sku']),
        period: periodEnum,
        from: z.string().optional(),
        to: z.string().optional(),
        storeId: locationFields.storeId,
        regionId: locationFields.regionId,
        storeName: locationFields.storeName,
        regionName: locationFields.regionName,
        limit: z.number().optional(),
      }),
      execute: async (args) => mt.breakdown(args),
    }),
    compare_periods: tool({
      description:
        'Compare a metric to the prior window of equal length, or year-over-year. Pass storeName/regionName when the user names a place.',
      inputSchema: z.object({
        metric: metricEnum,
        period: periodEnum,
        from: z.string().optional(),
        to: z.string().optional(),
        mode: z.enum(['prior', 'yoy']).optional(),
        ...locationFields,
      }),
      execute: async (args) =>
        mt.compare_periods({ ...args, metric: args.metric as MetricName }),
    }),
    explain_change: tool({
      description:
        'Decompose a net-sales change vs the prior period by store/region/SKU. Includes unexplained remainder. Pass storeName for a city or store.',
      inputSchema: z.object({
        period: periodEnum,
        from: z.string().optional(),
        to: z.string().optional(),
        dimension: z.enum(['region', 'store', 'sku']).optional(),
        ...locationFields,
      }),
      execute: async (args) => explainChange(rt, args),
    }),
    list_context_events: tool({
      description:
        'Holidays, stored weather, and company events overlapping a date window. Correlation, not causation. Pass from/to for the dates the user asked about — do not use the page default if they named another period.',
      inputSchema: z.object({
        period: periodEnum,
        from: z.string().optional(),
        to: z.string().optional(),
        ...locationFields,
      }),
      execute: async (args) => listContextEvents(rt, args),
    }),
    search_news: tool({
      description:
        'Semantic search over ingested news chunks in pgvector. Omit from/to unless the user named a date window, so the full news corpus is searched.',
      inputSchema: z.object({
        query: z.string(),
        period: periodEnum,
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      execute: async (args) => searchNews(rt, args),
    }),
  };
}
