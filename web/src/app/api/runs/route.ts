import { listRuns } from "@/lib/supabase/runs";

export const runtime = "nodejs";

export async function GET() {
  try {
    const runs = await listRuns(100);
    return Response.json({ ok: true, runs });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
