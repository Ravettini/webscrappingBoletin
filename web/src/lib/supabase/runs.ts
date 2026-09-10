import type { PersonaFila } from "@/lib/scraper/config";
import { getSupabaseAdmin } from "./server";

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "completed_with_errors";

export type RunRow = {
  id: string;
  created_at: string;
  finished_at: string | null;
  date_from: string;
  date_to: string;
  status: RunStatus;
  row_count: number;
  error: string | null;
  days_ok?: number;
  days_failed?: number;
  failed_dates?: string | null;
};

export type ResultRow = {
  id: string;
  run_id: string;
  created_at: string;
  fecha: string | null;
  tipo_accion: string | null;
  nombre: string | null;
  apellido: string | null;
  cuil: string | null;
  area: string | null;
  rol: string | null;
  articulo: string | null;
  decreto: string | null;
  contexto: string | null;
};

/** ISO yyyy-mm-dd o dd/mm/yyyy → yyyy-mm-dd */
function toDateISO(input: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(input)) {
    const [dd, mm, yyyy] = input.split("/");
    return `${yyyy}-${mm}-${dd}`;
  }
  return input;
}

export async function saveRunWithResults(opts: {
  from: string;
  to: string;
  rows: PersonaFila[];
  status: RunStatus;
  error?: string | null;
  daysOk?: number;
  daysFailed?: number;
  failedDates?: string[];
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return { ok: false, error: "Supabase no configurado (faltan env vars)." };
  }

  const dateFrom = toDateISO(opts.from);
  const dateTo = toDateISO(opts.to);

  const { data: run, error: runErr } = await sb
    .from("runs")
    .insert({
      date_from: dateFrom,
      date_to: dateTo,
      status: opts.status,
      row_count: opts.rows.length,
      finished_at: new Date().toISOString(),
      error: opts.error ?? null,
      days_ok: opts.daysOk ?? 0,
      days_failed: opts.daysFailed ?? 0,
      failed_dates: opts.failedDates?.length
        ? opts.failedDates.join(", ")
        : null,
    })
    .select("id")
    .single();

  if (runErr || !run) {
    return { ok: false, error: runErr?.message || "No se pudo crear la corrida." };
  }

  if (opts.rows.length) {
    const payload = opts.rows.map((r) => ({
      run_id: run.id,
      fecha: r.fecha || null,
      tipo_accion: r.tipo_accion || null,
      nombre: r.nombre || null,
      apellido: r.apellido || null,
      cuil: r.cuil || null,
      area: r.area || null,
      rol: r.rol || null,
      articulo: r.articulo || null,
      decreto: r.decreto || null,
      contexto: r.contexto || null,
    }));

    const chunk = 200;
    for (let i = 0; i < payload.length; i += chunk) {
      const slice = payload.slice(i, i + chunk);
      const { error: resErr } = await sb.from("run_results").insert(slice);
      if (resErr) {
        return {
          ok: false,
          error: `Corrida ${run.id} creada pero falló insert de resultados: ${resErr.message}`,
        };
      }
    }
  }

  return { ok: true, runId: run.id };
}

export async function listRuns(limit = 50): Promise<RunRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from("runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []) as RunRow[];
}

export async function listResults(opts?: {
  runId?: string;
  limit?: number;
  offset?: number;
}): Promise<(ResultRow & { run_created_at?: string })[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;

  let q = sb
    .from("run_results")
    .select("*, runs(created_at)")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.runId) {
    q = q.eq("run_id", opts.runId);
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return (data || []).map((row) => {
    const { runs, ...rest } = row as ResultRow & {
      runs?: { created_at: string } | null;
    };
    return {
      ...rest,
      run_created_at: runs?.created_at,
    };
  });
}

export async function listResultsByRun(runId: string): Promise<ResultRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from("run_results")
    .select("*")
    .eq("run_id", runId)
    .order("fecha", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as ResultRow[];
}

/** Todas las filas (paginado) para export Excel; opcionalmente filtradas por corrida. */
export async function listAllResults(opts?: {
  runId?: string;
}): Promise<ResultRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];

  const pageSize = 1000;
  const all: ResultRow[] = [];
  let offset = 0;

  for (;;) {
    let q = sb
      .from("run_results")
      .select("*")
      .order("fecha", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (opts?.runId) {
      q = q.eq("run_id", opts.runId);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const batch = (data || []) as ResultRow[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}
