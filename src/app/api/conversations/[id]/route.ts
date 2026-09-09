import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const messages = await sql<
    { id: string; role: string; content: string; scope: string; run_id: string | null }[]
  >`
    SELECT id::text, role, content, scope, run_id::text
    FROM messages
    WHERE conversation_id = ${id}::uuid
    ORDER BY created_at ASC
  `;
  const [conv] = await sql<{ summary: string | null; summarized_n: number }[]>`
    SELECT summary,
      CASE WHEN summarized_through_message_id IS NULL THEN 0 ELSE 1 END AS summarized_n
    FROM conversations WHERE id = ${id}::uuid
  `;
  return Response.json({ messages, summary: conv?.summary ?? null });
}
