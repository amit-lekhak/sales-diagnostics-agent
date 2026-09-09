import { runSpans } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const spans = await runSpans(runId);
  return Response.json({ spans });
}
