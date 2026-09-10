import { getJob } from "@/lib/job/store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const job = await getJob();
  const logs = job.logs || [];
  const total = logs.length;
  const newLogs = offset <= total ? logs.slice(offset) : [];

  return Response.json({
    ok: true,
    running: job.running,
    started_at: job.started_at,
    finished_at: job.finished_at,
    exit_code: job.exit_code,
    error: job.error,
    dates_seen: job.dates_seen,
    logs: newLogs,
    next_offset: total,
  });
}
