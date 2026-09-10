import { google } from '@ai-sdk/google';
import { generateText } from 'ai';
import { sql } from '../db';
import { ensureGeminiKey } from './provider-config';
import { addSpan } from './tracer';

ensureGeminiKey();

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
const WINDOW = 12;
const TRIGGER = 16;

export async function loadConversationContext(conversationId: string) {
  const [conv] = await sql<
    {
      summary: string | null;
      summarized_through_message_id: string | null;
    }[]
  >`
    SELECT summary, summarized_through_message_id::text
    FROM conversations WHERE id = ${conversationId}::uuid
  `;
  const messages = await sql<{ id: string; role: string; content: string }[]>`
    SELECT id::text, role, content
    FROM messages
    WHERE conversation_id = ${conversationId}::uuid
    ORDER BY created_at ASC
  `;
  const cursor = conv?.summarized_through_message_id;
  let start = 0;
  if (cursor) {
    const idx = messages.findIndex((m) => m.id === cursor);
    if (idx >= 0) start = idx + 1;
  }
  const recent = messages.slice(Math.max(start, messages.length - WINDOW * 2));
  return {
    summary: conv?.summary ?? null,
    recent,
    allCount: messages.length,
    shouldSummarize: messages.length - start >= TRIGGER,
    messages,
  };
}

export async function maybeSummarize(conversationId: string, runId: string) {
  const ctx = await loadConversationContext(conversationId);
  if (!ctx.shouldSummarize) return;
  const older = ctx.messages.slice(0, Math.max(0, ctx.messages.length - WINDOW));
  if (!older.length) return;
  const started = new Date();
  try {
    const { text, usage } = await generateText({
      model: google(MODEL),
      prompt: `Summarize this sales-analytics chat for future turns. Keep facts, metric numbers, decisions, and open questions. Do not invent numbers.\n\nPrior summary:\n${ctx.summary ?? '(none)'}\n\nTurns:\n${older
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n')}`,
    });
    const lastId = older[older.length - 1]!.id;
    await sql`
      UPDATE conversations
      SET summary = ${text},
          summarized_through_message_id = ${lastId}::uuid,
          summary_updated_at = NOW()
      WHERE id = ${conversationId}::uuid
    `;
    await addSpan({
      runId,
      kind: 'summarize',
      name: 'compaction',
      startedAt: started,
      payloadIn: { turns: older.length },
      payloadOut: {
        chars: text.length,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      },
      tokenCount: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
    });
  } catch (err) {
    await addSpan({
      runId,
      kind: 'summarize',
      name: 'compaction',
      startedAt: started,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
