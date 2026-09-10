import { getBaseUrl, startJob } from "@/lib/job/runner";

export const maxDuration = 60;
export const runtime = "nodejs";

function hasPersistentStore() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      process.env.BLOB_READ_WRITE_TOKEN,
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    from?: string;
    to?: string;
  };

  // En Hobby sin Redis/Blob, el dashboard orquesta día por día desde el browser.
  if (!hasPersistentStore()) {
    return Response.json({
      ok: true,
      use_client_mode: true,
      mode: "client",
      from: body.from,
      to: body.to,
      message: "Sin store persistente: usando orquestación cliente.",
    });
  }

  const baseUrl = getBaseUrl(req);
  const result = await startJob(baseUrl, { from: body.from, to: body.to });
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 409 });
  }
  return Response.json({ ok: true, running: true, script: "http-range" });
}
