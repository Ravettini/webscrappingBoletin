import { assertInternalAuth, getBaseUrl, runTick } from "@/lib/job/runner";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!assertInternalAuth(req)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = getBaseUrl(req);
  // Process one day synchronously; chaining happens via after()
  await runTick(baseUrl);
  return Response.json({ ok: true });
}
