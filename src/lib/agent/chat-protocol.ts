import { z } from 'zod';
import type { ProviderErrorCode } from './provider-errors';

export const chatRequestSchema = z.object({
  conversationId: z.string().uuid().nullish(),
  message: z.string().trim().min(1).max(4000),
  scope: z.enum(['page', 'all']).nullish(),
  pageContext: z
    .object({
      page: z.string().optional(),
      pathname: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      storeId: z.number().optional(),
      regionId: z.number().optional(),
      productId: z.number().optional(),
    })
    .passthrough()
    .nullish(),
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

export const sseEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('meta'),
    conversationId: z.string(),
    runId: z.string(),
  }),
  z.object({
    type: z.literal('delta'),
    text: z.string(),
    conversationId: z.string().optional(),
    runId: z.string().optional(),
  }),
  z.object({
    type: z.literal('done'),
    conversationId: z.string(),
    runId: z.string(),
  }),
  z.object({
    type: z.literal('error'),
    error: z.string(),
    code: z.string().optional(),
    retryAfterMs: z.number().nullable().optional(),
    conversationId: z.string().optional(),
    runId: z.string().optional(),
  }),
]);

export type SseEvent = z.infer<typeof sseEventSchema>;

export type ProviderErrorSse = {
  type: 'error';
  error: string;
  code: ProviderErrorCode;
  retryAfterMs: number | null;
  conversationId?: string;
  runId?: string;
};
