import { stopJob } from "@/lib/job/runner";

export const runtime = "nodejs";

export async function POST() {
  const result = await stopJob();
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 409 });
  }
  return Response.json({ ok: true });
}
