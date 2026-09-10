import { put } from "@vercel/blob";
import { buildExcelBuffer } from "@/lib/scraper/excel";
import type { PersonaFila } from "@/lib/scraper/config";
import { saveRunWithResults } from "@/lib/supabase/runs";
import { getJob, saveJob } from "./store";

function dedupeRows(rows: PersonaFila[]): PersonaFila[] {
  const seen = new Set<string>();
  const out: PersonaFila[] = [];
  for (const f of rows) {
    const key = [
      f.fecha,
      f.tipo_accion,
      f.nombre,
      f.apellido,
      f.cuil,
      f.decreto,
      f.articulo,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  out.sort((a, b) => {
    const ka = `${a.fecha}|${a.decreto}|${a.articulo}|${a.tipo_accion}|${a.apellido}|${a.nombre}`;
    const kb = `${b.fecha}|${b.decreto}|${b.articulo}|${b.tipo_accion}|${b.apellido}|${b.nombre}`;
    return ka.localeCompare(kb, "es");
  });
  return out;
}

function inferRange(rows: PersonaFila[], queue: string[]): { from: string; to: string } {
  const dates = [
    ...new Set([
      ...queue,
      ...rows.map((r) => r.fecha).filter(Boolean),
    ]),
  ].sort((a, b) => {
    const pa = a.includes("/") ? a.split("/").reverse().join("-") : a;
    const pb = b.includes("/") ? b.split("/").reverse().join("-") : b;
    return pa.localeCompare(pb);
  });
  if (!dates.length) {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return { from: iso, to: iso };
  }
  const toIso = (d: string) =>
    d.includes("/") ? d.split("/").reverse().join("-") : d;
  return { from: toIso(dates[0]), to: toIso(dates[dates.length - 1]) };
}

export async function finalizeExcel(): Promise<void> {
  const job = await getJob();
  const rows = dedupeRows(job.rows);
  job.rows = rows;

  const range = inferRange(rows, job.dates_queue || []);

  const daysOk = (job.dates_seen || []).length;
  const daysFailed = Math.max(0, (job.dates_queue || []).length - daysOk);
  const status =
    job.cancel
      ? "cancelled"
      : daysFailed > 0 && rows.length === 0
        ? "failed"
        : daysFailed > 0
          ? "completed_with_errors"
          : "completed";

  if (!rows.length) {
    job.logs.push("No encontré registros finales.");
    job.excel_url = null;
    job.excel_b64 = null;
    const saved = await saveRunWithResults({
      from: range.from,
      to: range.to,
      rows: [],
      status,
      daysOk,
      daysFailed,
      error:
        daysFailed > 0
          ? `Días OK: ${daysOk}. Posibles omisiones: ${daysFailed}.`
          : null,
    });
    if (saved.ok) job.logs.push(`Corrida guardada en Supabase: ${saved.runId}`);
    else job.logs.push(`Supabase: ${saved.error}`);
    await saveJob(job);
    return;
  }

  const buf = await buildExcelBuffer(rows);
  job.logs.push(`Excel generado con ${rows.length} filas.`);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`scrapbo/decretos_cuil-${Date.now()}.xlsx`, buf, {
      access: "public",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    job.excel_url = blob.url;
    job.excel_b64 = null;
  } else {
    job.excel_url = null;
    job.excel_b64 = buf.toString("base64");
  }

  const saved = await saveRunWithResults({
    from: range.from,
    to: range.to,
    rows,
    status,
    daysOk,
    daysFailed,
    error:
      daysFailed > 0
        ? `Días OK: ${daysOk}. Posibles omisiones: ${daysFailed}.`
        : null,
  });
  if (saved.ok) job.logs.push(`Corrida guardada en Supabase: ${saved.runId}`);
  else job.logs.push(`Supabase: ${saved.error}`);

  await saveJob(job);
}
