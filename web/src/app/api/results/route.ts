import { listResults } from "@/lib/supabase/runs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("run_id") || undefined;
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit") || 200)));
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));
    const results = await listResults({ runId, limit, offset });
    return Response.json({ ok: true, results, limit, offset });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
