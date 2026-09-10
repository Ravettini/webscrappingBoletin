"use client";

import { AppSidebar } from "@/components/AppSidebar";
import { useCallback, useEffect, useState } from "react";

type Run = {
  id: string;
  created_at: string;
  finished_at: string | null;
  date_from: string;
  date_to: string;
  status: string;
  row_count: number;
  error: string | null;
  days_ok?: number;
  days_failed?: number;
  failed_dates?: string | null;
};

type Result = {
  id: string;
  run_id: string;
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
  run_created_at?: string;
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-AR");
  } catch {
    return iso;
  }
}

function statusLabel(s: string) {
  const map: Record<string, string> = {
    completed: "Completada",
    completed_with_errors: "Con errores",
    failed: "Fallida",
    cancelled: "Cancelada",
    running: "En curso",
  };
  return map[s] || s;
}

function statusClass(s: string) {
  if (s === "completed") return "text-tertiary font-semibold";
  if (s === "completed_with_errors") return "text-amber-700 font-semibold";
  if (s === "failed") return "text-on-error-container font-semibold";
  if (s === "cancelled") return "text-secondary font-semibold";
  return "";
}

export default function HistoricoPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandCols, setExpandCols] = useState(true);
  const [downloading, setDownloading] = useState(false);

  function downloadExcel(runId?: string | null) {
    setDownloading(true);
    const qs = runId ? `?run_id=${encodeURIComponent(runId)}` : "";
    window.location.href = `/api/results/excel${qs}`;
    window.setTimeout(() => setDownloading(false), 1500);
  }

  const loadRuns = useCallback(async () => {
    const res = await fetch("/api/runs");
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Error al cargar ejecuciones");
    setRuns(data.runs || []);
  }, []);

  const loadResults = useCallback(async (runId: string | null) => {
    const url = runId
      ? `/api/results?run_id=${encodeURIComponent(runId)}&limit=500`
      : "/api/results?limit=500";
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Error al cargar resultados");
    setResults(data.results || []);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await loadRuns();
      await loadResults(selectedRunId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadRuns, loadResults, selectedRunId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function selectRun(id: string | null) {
    setSelectedRunId(id);
    setLoading(true);
    setError(null);
    try {
      await loadResults(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col lg:flex-row">
      <AppSidebar />
      <main className="flex-1 flex flex-col min-w-0 w-full">
        <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 w-full px-4 sm:px-6 lg:px-10 py-4 lg:py-6 bg-surface sticky top-[57px] lg:top-0 z-10">
          <div className="min-w-0">
            <h1 className="font-headline tracking-tight font-bold text-xl sm:text-2xl text-primary">
              Histórico consolidado
            </h1>
            <p className="font-body text-xs sm:text-sm text-secondary opacity-80">
              Ejecuciones guardadas y filas de resultados en Supabase
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
            <button
              type="button"
              onClick={() => downloadExcel(selectedRunId)}
              disabled={downloading || results.length === 0}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-tertiary text-white text-sm font-label uppercase tracking-widest shrink-0 disabled:opacity-40"
              title={
                selectedRunId
                  ? "Descargar Excel de la ejecución seleccionada"
                  : "Descargar Excel consolidado"
              }
            >
              <span className="material-symbols-outlined text-base">download</span>
              {downloading ? "…" : "Excel"}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-label uppercase tracking-widest shrink-0"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
              Actualizar
            </button>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 lg:p-10 space-y-6 lg:space-y-8 overflow-y-auto">
          {error && (
            <div className="bg-error-container text-on-error-container rounded-xl px-4 py-3 text-sm break-words">
              {error}
            </div>
          )}

          <section className="bg-surface-container-lowest rounded-2xl p-4 sm:p-6 shadow-[0px_20px_40px_rgba(25,28,29,0.06)]">
            <div className="flex items-center justify-between mb-4 gap-2">
              <h2 className="font-headline font-bold text-lg text-primary">Ejecuciones</h2>
              <span className="text-xs text-secondary font-label uppercase tracking-widest shrink-0">
                {runs.length} registros
              </span>
            </div>

            {/* Cards mobile */}
            <div className="md:hidden space-y-3">
              {runs.length === 0 && !loading && (
                <p className="py-4 text-secondary text-sm">
                  Todavía no hay ejecuciones. Ejecutá un scraping desde el Dashboard.
                </p>
              )}
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void selectRun(r.id)}
                  className={`w-full text-left rounded-xl border p-4 transition ${
                    selectedRunId === r.id
                      ? "border-primary bg-tertiary-fixed/40"
                      : "border-outline-variant/30 bg-surface"
                  }`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className={`text-sm ${statusClass(r.status)}`}>
                      {statusLabel(r.status)}
                    </div>
                    <div className="font-headline font-bold text-primary">{r.row_count} filas</div>
                  </div>
                  <p className="text-xs text-secondary mt-2">{fmtDate(r.created_at)}</p>
                  <p className="font-mono text-xs mt-1 break-all">
                    {r.date_from} → {r.date_to}
                  </p>
                  <p className="text-xs text-secondary mt-1">
                    OK {r.days_ok ?? "—"} / fail {r.days_failed ?? "—"}
                  </p>
                  {r.error && (
                    <p className="text-[11px] text-secondary mt-2 break-words">{r.error}</p>
                  )}
                  {r.row_count > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadExcel(r.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          e.preventDefault();
                          downloadExcel(r.id);
                        }
                      }}
                      className="inline-flex items-center gap-1 mt-3 text-xs font-bold text-tertiary underline"
                    >
                      <span className="material-symbols-outlined text-sm">download</span>
                      Excel
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Table desktop */}
            <div className="hidden md:block overflow-x-auto -mx-1 px-1">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-secondary font-label text-[10px] uppercase tracking-widest border-b border-outline-variant/40">
                    <th className="py-2 pr-3">Ejecutada</th>
                    <th className="py-2 pr-3">Intervalo</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">Días</th>
                    <th className="py-2 pr-3">Filas</th>
                    <th className="py-2">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="py-6 text-secondary">
                        Todavía no hay ejecuciones. Ejecutá un scraping desde el Dashboard.
                      </td>
                    </tr>
                  )}
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b border-outline-variant/20 ${selectedRunId === r.id ? "bg-tertiary-fixed/40" : ""}`}
                    >
                      <td className="py-3 pr-3 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td className="py-3 pr-3 font-mono text-xs">
                        {r.date_from} → {r.date_to}
                      </td>
                      <td className={`py-3 pr-3 ${statusClass(r.status)}`}>
                        <div>{statusLabel(r.status)}</div>
                        {r.error && (
                          <div
                            className="text-[11px] text-secondary font-normal mt-1 max-w-[280px]"
                            title={r.error}
                          >
                            {r.error}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs whitespace-nowrap">
                        OK {r.days_ok ?? "—"} / fail {r.days_failed ?? "—"}
                      </td>
                      <td className="py-3 pr-3 font-headline font-bold">{r.row_count}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            className="text-primary text-xs font-bold underline"
                            onClick={() => void selectRun(r.id)}
                          >
                            Ver filas
                          </button>
                          {r.row_count > 0 && (
                            <button
                              type="button"
                              className="text-tertiary text-xs font-bold underline"
                              onClick={() => downloadExcel(r.id)}
                              title="Descargar Excel de esta ejecución"
                            >
                              Excel
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-surface-container-lowest rounded-2xl p-4 sm:p-6 shadow-[0px_20px_40px_rgba(25,28,29,0.06)]">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="min-w-0">
                <h2 className="font-headline font-bold text-lg text-primary">
                  Resultados
                </h2>
                <p className="text-xs text-secondary break-words">
                  {selectedRunId
                    ? `Filtrado por ejecución ${selectedRunId.slice(0, 8)}…`
                    : "Consolidado de todas las ejecuciones"}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setExpandCols((v) => !v)}
                  className={`text-xs font-label uppercase tracking-widest px-3 py-2 rounded-lg ${
                    expandCols
                      ? "bg-primary text-white"
                      : "bg-surface-container-low text-primary"
                  }`}
                >
                  {expandCols ? "Columnas extendidas" : "Extender columnas"}
                </button>
                {selectedRunId && (
                  <button
                    type="button"
                    onClick={() => void selectRun(null)}
                    className="text-xs font-label uppercase tracking-widest px-3 py-2 rounded-lg bg-surface-container-low"
                  >
                    Ver todas
                  </button>
                )}
              </div>
            </div>

            {loading ? (
              <p className="text-secondary text-sm">Cargando…</p>
            ) : (
              <div className="overflow-x-auto -mx-1 px-1">
                <table
                  className={`text-sm ${expandCols ? "min-w-[1100px] sm:min-w-[1400px] w-max" : "w-full min-w-[640px] table-fixed"}`}
                >
                  <thead>
                    <tr className="text-left text-secondary font-label text-[10px] uppercase tracking-widest border-b border-outline-variant/40">
                      <th className="py-2 pr-3 whitespace-nowrap">Fecha</th>
                      <th className="py-2 pr-3 whitespace-nowrap">Acción</th>
                      <th className="py-2 pr-3 whitespace-nowrap">Nombre</th>
                      <th className="py-2 pr-3 whitespace-nowrap">Apellido</th>
                      <th className="py-2 pr-3 whitespace-nowrap">CUIL</th>
                      <th className={`py-2 pr-3 ${expandCols ? "min-w-[220px]" : ""}`}>
                        Área
                      </th>
                      <th className={`py-2 pr-3 ${expandCols ? "min-w-[240px]" : ""}`}>
                        Rol
                      </th>
                      <th className="py-2 pr-3 whitespace-nowrap">Artículo</th>
                      <th className={`py-2 pr-3 ${expandCols ? "min-w-[200px]" : ""}`}>
                        Decreto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-6 text-secondary">
                          Sin resultados para mostrar.
                        </td>
                      </tr>
                    )}
                    {results.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-outline-variant/20 align-top"
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">{row.fecha}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{row.tipo_accion}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{row.nombre}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">{row.apellido}</td>
                        <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                          {row.cuil}
                        </td>
                        <td
                          className={`py-2 pr-3 ${
                            expandCols
                              ? "whitespace-normal break-words"
                              : "truncate max-w-[140px]"
                          }`}
                          title={row.area || ""}
                        >
                          {row.area}
                        </td>
                        <td
                          className={`py-2 pr-3 ${
                            expandCols
                              ? "whitespace-normal break-words"
                              : "truncate max-w-[140px]"
                          }`}
                          title={row.rol || ""}
                        >
                          {row.rol}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{row.articulo}</td>
                        <td
                          className={`py-2 pr-3 ${
                            expandCols
                              ? "whitespace-normal break-words"
                              : "truncate max-w-[160px]"
                          }`}
                          title={row.decreto || ""}
                        >
                          {row.decreto}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
