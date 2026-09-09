import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await sql<{ id: string; title: string; updated_at: string }[]>`
    SELECT id::text, title, updated_at::text
    FROM conversations
    ORDER BY updated_at DESC
    LIMIT 3
  `;
  return Response.json({ conversations: rows });
}

export async function POST() {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO conversations (title) VALUES ('New chat')
    RETURNING id::text AS id
  `;
  return Response.json({ id: row!.id });
}
