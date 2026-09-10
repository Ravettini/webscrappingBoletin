import { buildExcelBuffer } from "@/lib/scraper/excel";
import type { PersonaFila } from "@/lib/scraper/config";
import { getDatesInRange, getMondayToFridayDates } from "@/lib/scraper/dates";
import { processDate } from "@/lib/scraper/process";
import { saveRunWithResults, type RunStatus } from "@/lib/supabase/runs";

export const maxDuration = 60;
export const runtime = "nodejs";

const DAY_RETRIES = 3;

async function processDateWithRetries(fecha: string) {
  let lastError = "";
  const logs: string[] = [];
  for (let attempt = 1; attempt <= DAY_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        logs.push(`Reintento ${attempt}/${DAY_RETRIES} para ${fecha}...`);
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
      const result = await processDate(fecha);
      return {
        ok: true as const,
        fecha: result.fecha,
        filas: result.filas,
        logs: [...logs, ...result.logs],
        attempts: attempt,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      logs.push(`Intento ${attempt}/${DAY_RETRIES} falló (${fecha}): ${lastError}`);
    }
  }
  return {
    ok: false as const,
    fecha,
    filas: [] as PersonaFila[],
    logs,
    error: lastError || "Error desconocido",
    attempts: DAY_RETRIES,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    fecha?: string;
    from?: string;
    to?: string;
    action?: "dates" | "day" | "finalize";
    rows?: PersonaFila[];
    status?: RunStatus;
    error?: string;
    daysOk?: number;
    daysFailed?: number;
    failedDates?: string[];
  };

  const action = body.action || "dates";

  if (action === "dates") {
    if (body.from && body.to) {
      const range = getDatesInRange(body.from, body.to);
      if (!range.ok) {
        return Response.json({ ok: false, error: range.error }, { status: 400 });
      }
      return Response.json({
        ok: true,
        mode: "client",
        dates: range.dates,
        from: body.from,
        to: body.to,
      });
    }
    return Response.json({
      ok: true,
      mode: "client",
      dates: getMondayToFridayDates(),
    });
  }

  if (action === "day") {
    if (!body.fecha) {
      return Response.json({ ok: false, error: "fecha requerida" }, { status: 400 });
    }
    const result = await processDateWithRetries(body.fecha);
    if (!result.ok) {
      return Response.json(
        {
          ok: false,
          fecha: result.fecha,
          filas: [],
          logs: result.logs,
          error: result.error,
          attempts: result.attempts,
        },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      fecha: result.fecha,
      filas: result.filas,
      logs: result.logs,
      attempts: result.attempts,
    });
  }

  if (action === "finalize") {
    const rows = body.rows || [];
    const from = body.from;
    const to = body.to;
    const daysFailed = body.daysFailed ?? 0;
    let status: RunStatus = body.status || "completed";
    if (status === "completed" && daysFailed > 0) {
      status = "completed_with_errors";
    }
    if (status === "completed" && rows.length === 0 && daysFailed > 0) {
      status = "failed";
    }

    let runId: string | null = null;
    let supabaseMsg: string | null = null;

    if (from && to) {
      const saved = await saveRunWithResults({
        from,
        to,
        rows,
        status,
        error: body.error ?? null,
        daysOk: body.daysOk,
        daysFailed: body.daysFailed,
        failedDates: body.failedDates,
      });
      if (saved.ok) {
        runId = saved.runId;
        supabaseMsg = `Corrida guardada en Supabase: ${saved.runId} (${status})`;
      } else {
        supabaseMsg = `Supabase: ${saved.error}`;
      }
    }

    if (!rows.length) {
      return Response.json({
        ok: true,
        empty: true,
        message:
          daysFailed > 0
            ? `Sin registros. Días OK: ${body.daysOk ?? 0}, fallidos: ${daysFailed}.`
            : "No encontré registros finales.",
        run_id: runId,
        supabase: supabaseMsg,
        status,
      });
    }

    const buf = await buildExcelBuffer(rows);
    return Response.json({
      ok: true,
      empty: false,
      filename: "decretos_cuil.xlsx",
      excel_b64: buf.toString("base64"),
      count: rows.length,
      run_id: runId,
      supabase: supabaseMsg,
      status,
    });
  }

  return Response.json({ ok: false, error: "action inválida" }, { status: 400 });
}
