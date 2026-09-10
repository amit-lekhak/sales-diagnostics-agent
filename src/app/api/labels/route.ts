import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [regions, stores, products] = await Promise.all([
    sql<{ id: number; name: string }[]>`SELECT id, name FROM regions ORDER BY id`,
    sql<{ id: number; name: string }[]>`SELECT id, name FROM stores ORDER BY id`,
    sql<{ id: number; name: string }[]>`SELECT id, name FROM products ORDER BY id`,
  ]);
  return Response.json({ regions, stores, products });
}
