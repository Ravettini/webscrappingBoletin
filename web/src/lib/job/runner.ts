import { after } from "next/server";
import { getDatesInRange, getMondayToFridayDates } from "@/lib/scraper/dates";
import { processDate } from "@/lib/scraper/process";
import { finalizeExcel } from "./finalize";
import { appendLogs, emptyJob, getJob, saveJob } from "./store";

function internalSecret(): string {
  return process.env.JOB_INTERNAL_SECRET || "scrapbo-dev-secret";
}

export function assertInternalAuth(req: Request): boolean {
  const h = req.headers.get("x-job-secret");
  return h === internalSecret();
}

async function enqueueTick(baseUrl: string): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/job/tick`;
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-job-secret": internalSecret(),
    },
    cache: "no-store",
  });
}

export async function startJob(
  baseUrl: string,
  range?: { from?: string; to?: string },
): Promise<{ ok: boolean; error?: string }> {
  const current = await getJob();
  if (current.running) {
    return { ok: false, error: "Ya hay un proceso en ejecución." };
  }

  let dates: string[];
  if (range?.from && range?.to) {
    const result = getDatesInRange(range.from, range.to);
    if (!result.ok) return { ok: false, error: result.error };
    dates = result.dates;
  } else {
    dates = getMondayToFridayDates();
  }

  const job = emptyJob();
  job.running = true;
  job.started_at = Date.now() / 1000;
  job.dates_queue = dates;
  job.date_index = 0;
  job.logs = [
    `Iniciando scraping HTTP... Fechas (${dates.length}): ${dates.join(", ") || "(ninguna)"}`,
  ];
  await saveJob(job);

  after(async () => {
    try {
      await enqueueTick(baseUrl);
    } catch (e) {
      const j = await getJob();
      j.running = false;
      j.error = e instanceof Error ? e.message : String(e);
      j.finished_at = Date.now() / 1000;
      j.exit_code = 1;
      await saveJob(j);
    }
  });

  return { ok: true };
}

export async function stopJob(): Promise<{ ok: boolean; error?: string }> {
  const job = await getJob();
  if (!job.running) {
    return { ok: false, error: "No hay proceso en ejecución." };
  }
  job.cancel = true;
  job.logs.push("Se envió señal de detención al proceso.");
  await saveJob(job);
  return { ok: true };
}

export async function runTick(baseUrl: string): Promise<void> {
  let job = await getJob();
  if (!job.running) return;

  if (job.cancel) {
    job.running = false;
    job.finished_at = Date.now() / 1000;
    job.exit_code = 130;
    job.error = "Cancelado por el usuario.";
    job.logs.push("Proceso detenido.");
    await saveJob(job);
    return;
  }

  if (job.date_index >= job.dates_queue.length) {
    await finalizeExcel();
    job = await getJob();
    job.running = false;
    job.finished_at = Date.now() / 1000;
    job.exit_code = 0;
    job.logs.push("Scraping finalizado correctamente.");
    await saveJob(job);
    return;
  }

  const fecha = job.dates_queue[job.date_index];
  try {
    const result = await processDate(fecha);
    job = await getJob();
    if (job.cancel) {
      job.running = false;
      job.finished_at = Date.now() / 1000;
      job.exit_code = 130;
      job.error = "Cancelado por el usuario.";
      job.logs.push(...result.logs, "Proceso detenido.");
      await saveJob(job);
      return;
    }
    job.logs.push(...result.logs);
    if (job.logs.length > 1500) job.logs = job.logs.slice(-1500);
    if (!job.dates_seen.includes(fecha)) job.dates_seen.push(fecha);
    job.rows.push(...result.filas);
    job.date_index += 1;
    await saveJob(job);
  } catch (e) {
    await appendLogs([
      `Error en fecha ${fecha}: ${e instanceof Error ? e.message : String(e)}`,
    ]);
    job = await getJob();
    job.date_index += 1;
    if (!job.dates_seen.includes(fecha)) job.dates_seen.push(fecha);
    await saveJob(job);
  }

  job = await getJob();
  if (!job.running) return;

  // Encadenar siguiente día
  after(async () => {
    try {
      await enqueueTick(baseUrl);
    } catch (e) {
      const j = await getJob();
      j.running = false;
      j.error = e instanceof Error ? e.message : String(e);
      j.finished_at = Date.now() / 1000;
      j.exit_code = 1;
      j.logs.push(`Fallo al encadenar tick: ${j.error}`);
      await saveJob(j);
    }
  });
}

export function getBaseUrl(req: Request): string {
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) return `${proto}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
}
