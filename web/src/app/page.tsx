"use client";

import { AppSidebar } from "@/components/AppSidebar";
import { DateRangeCalendar } from "@/components/DateRangeCalendar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type StatusPayload = {
  ok: boolean;
  running: boolean;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  error: string | null;
  dates_seen: string[];
  logs: string[];
  next_offset: number;
};

type PersonaFila = {
  fecha: string;
  tipo_accion: string;
  nombre: string;
  apellido: string;
  cuil: string;
  area: string;
  rol: string;
  articulo: string;
  decreto: string;
  contexto: string;
};

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  return { from: toISO(monday), to: toISO(today) };
}

export default function DashboardPage() {
  const initial = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [running, setRunning] = useState(false);
  const [statusChip, setStatusChip] = useState("Listo");
  const [percent, setPercent] = useState(0);
  const [summary, setSummary] = useState("Esperando ejecución...");
  const [datesText, setDatesText] = useState("Fechas detectadas: -");
  const [consoleText, setConsoleText] = useState(
    '[INFO] Interfaz lista. Elegí el intervalo y presioná "Ejecutar".',
  );
  const logOffset = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);
  const excelB64Ref = useRef<string | null>(null);

  const appendLog = useCallback((level: string, text: string) => {
    const now = new Date().toLocaleTimeString();
    setConsoleText((prev) => `${prev}\n[${level}] [${now}] ${text}`);
  }, []);

  const setRunningUi = useCallback((isRunning: boolean) => {
    setRunning(isRunning);
    setStatusChip(isRunning ? "Ejecutando" : "Listo");
    if (isRunning) {
      setPercent(10);
      setSummary("Scraping en curso. Esto puede demorar varios minutos.");
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/job/status?offset=${logOffset.current}`);
      const data = (await res.json()) as StatusPayload;

      if (data.logs?.length) {
        for (const line of data.logs) {
          appendLog("LOG", line);
        }
      }
      logOffset.current = data.next_offset || logOffset.current;

      const dates = data.dates_seen || [];
      setDatesText(
        `Fechas detectadas: ${dates.length ? dates.join(", ") : "-"}`,
      );

      if (data.running) {
        setRunningUi(true);
        const pct = Math.min(95, 10 + dates.length * 10);
        setPercent(pct);
        setSummary(`Procesando... ${dates.length} fecha(s) detectada(s).`);
      } else {
        setRunningUi(false);
        if (data.error) {
          setPercent(100);
          setSummary("Finalizó con error.");
          appendLog("ERROR", data.error);
        } else if (data.exit_code === 0) {
          setPercent(100);
          setSummary("Completado. Excel generado.");
          appendLog("OK", "Scraping finalizado correctamente.");
        } else if (data.exit_code !== null) {
          setPercent(100);
          setSummary(`Finalizó con código ${data.exit_code}.`);
          appendLog("ERROR", `El proceso terminó con código ${data.exit_code}.`);
        }
        stopPolling();
      }
    } catch (err) {
      setSummary("Error de conexión.");
      appendLog("ERROR", String(err));
    }
  }, [appendLog, setRunningUi, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function runClientMode(rangeFrom: string, rangeTo: string) {
    cancelRef.current = false;
    excelB64Ref.current = null;
    const datesRes = await fetch("/api/job/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dates", from: rangeFrom, to: rangeTo }),
    });
    const datesData = await datesRes.json();
    if (!datesRes.ok || !datesData.ok) {
      appendLog("ERROR", datesData.error || "Intervalo inválido.");
      setSummary(datesData.error || "Intervalo inválido.");
      setRunningUi(false);
      return;
    }
    const dates: string[] = datesData.dates || [];
    appendLog(
      "INFO",
      `Intervalo ${rangeFrom} → ${rangeTo}. Días a procesar: ${dates.length}`,
    );
    appendLog("INFO", `Fechas: ${dates.join(", ") || "(ninguna)"}`);

    const allRows: PersonaFila[] = [];
    const seenDates: string[] = [];
    const failedDates: string[] = [];
    let daysOk = 0;

    for (let i = 0; i < dates.length; i++) {
      if (cancelRef.current) {
        appendLog("INFO", "Proceso detenido por el usuario.");
        break;
      }
      const fecha = dates[i];
      appendLog("INFO", `Procesando fecha: ${fecha}`);

      let dayOk = false;
      let lastErr = "";
      // Reintentos también del lado del cliente (timeouts de red / 502)
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (cancelRef.current) break;
        try {
          if (attempt > 1) {
            appendLog("INFO", `Reintento cliente ${attempt}/3 para ${fecha}...`);
            await new Promise((r) => setTimeout(r, 1200 * attempt));
          }
          const dayRes = await fetch("/api/job/client", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "day", fecha }),
          });
          const dayData = await dayRes.json();
          for (const line of dayData.logs || []) {
            appendLog("LOG", line);
          }
          if (!dayRes.ok || !dayData.ok) {
            lastErr = dayData.error || `HTTP ${dayRes.status}`;
            appendLog("ERROR", `Fallo ${fecha} (intento ${attempt}): ${lastErr}`);
            continue;
          }
          allRows.push(...(dayData.filas || []));
          appendLog(
            "OK",
            `${fecha}: ${(dayData.filas || []).length} filas (acumulado ${allRows.length})`,
          );
          dayOk = true;
          break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          appendLog("ERROR", `Excepción ${fecha} (intento ${attempt}): ${lastErr}`);
        }
      }

      seenDates.push(fecha);
      if (dayOk) {
        daysOk += 1;
      } else {
        failedDates.push(fecha);
        appendLog("ERROR", `Día ${fecha} agotó reintentos. Se omite.`);
      }

      // Pausa entre días para no saturar la API del boletín.
      if (i < dates.length - 1 && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, 600));
      }

      setDatesText(
        `Fechas: ${seenDates.length}/${dates.length} · OK ${daysOk} · fallidos ${failedDates.length} · filas ${allRows.length}`,
      );
      const pct = Math.min(95, 10 + ((i + 1) / Math.max(dates.length, 1)) * 85);
      setPercent(Math.round(pct));
      setSummary(
        `Procesando... ${seenDates.length}/${dates.length} · fallidos: ${failedDates.length}`,
      );
    }

    const cancelled = cancelRef.current;
    let status: "completed" | "failed" | "cancelled" | "completed_with_errors" =
      "completed";
    if (cancelled) status = "cancelled";
    else if (failedDates.length > 0 && allRows.length === 0) status = "failed";
    else if (failedDates.length > 0) status = "completed_with_errors";

    const errorSummary =
      failedDates.length > 0
        ? `Días OK: ${daysOk}. Fallidos (${failedDates.length}): ${failedDates.join(", ")}`
        : cancelled
          ? "Cancelado por el usuario."
          : null;

    if (failedDates.length) {
      appendLog("WARN", errorSummary || "");
    }

    const finRes = await fetch("/api/job/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "finalize",
        rows: allRows,
        from: rangeFrom,
        to: rangeTo,
        status,
        error: errorSummary,
        daysOk,
        daysFailed: failedDates.length,
        failedDates,
      }),
    });
    const finData = await finRes.json();
    if (finData.supabase) {
      appendLog("INFO", finData.supabase);
    }
    if (finData.empty) {
      appendLog("INFO", finData.message || "Sin registros.");
      setSummary(
        status === "failed"
          ? `Falló: ${failedDates.length} día(s) con error, 0 filas.`
          : "Sin registros finales.",
      );
    } else if (finData.excel_b64) {
      excelB64Ref.current = finData.excel_b64;
      appendLog("OK", `Excel generado con ${finData.count} filas.`);
      setSummary(
        status === "completed_with_errors"
          ? `Completado con errores (${failedDates.length} día(s)). ${finData.count} filas.`
          : status === "cancelled"
            ? `Cancelado. Se guardaron ${finData.count} filas parciales.`
            : "Completado. Excel generado.",
      );
    } else {
      appendLog("ERROR", finData.error || "No se pudo generar Excel.");
      setSummary("Finalizó con error.");
    }
    setPercent(100);
    setRunningUi(false);
  }

  async function onRun() {
    setRunningUi(true);
    logOffset.current = 0;
    setConsoleText(
      '[INFO] Interfaz lista. Elegí el intervalo y presioná "Ejecutar".',
    );
    appendLog("INFO", `Iniciando scraper (${from} → ${to})...`);
    try {
      const res = await fetch("/api/job/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();

      if (data.mode === "client" || data.use_client_mode) {
        await runClientMode(from, to);
        return;
      }

      if (!res.ok || !data.ok) {
        appendLog("INFO", data.error || "Usando orquestación desde el navegador...");
        await runClientMode(from, to);
        return;
      }
      stopPolling();
      pollTimer.current = setInterval(pollStatus, 2000);
      await pollStatus();
    } catch {
      appendLog("INFO", "Fallback a modo cliente...");
      try {
        await runClientMode(from, to);
      } catch (e2) {
        setRunningUi(false);
        appendLog("ERROR", String(e2));
      }
    }
  }

  async function onStop() {
    cancelRef.current = true;
    appendLog("INFO", "Solicitando detención...");
    try {
      const res = await fetch("/api/job/stop", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        appendLog("INFO", data.error || "Detención local aplicada.");
        return;
      }
      appendLog("INFO", "Se envió señal de detención.");
    } catch {
      appendLog("INFO", "Detención local aplicada.");
    }
  }

  function onDownload() {
    appendLog("INFO", "Abriendo descarga de Excel...");
    if (excelB64Ref.current) {
      const bin = atob(excelB64Ref.current);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "decretos_cuil.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    window.location.href = "/api/download";
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col lg:flex-row">
      <AppSidebar />

      <main className="flex-1 flex flex-col min-w-0 w-full">
        <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 w-full px-4 sm:px-6 lg:px-10 py-4 lg:py-6 bg-surface sticky top-[57px] lg:top-0 z-10">
          <div className="flex flex-col min-w-0">
            <h1 className="font-headline tracking-tight font-bold text-xl sm:text-2xl text-primary">
              SCRAPBO
            </h1>
            <p className="font-body text-xs sm:text-sm text-secondary opacity-80">
              Scraper Boletín Oficial · ejecución y generación de Excel
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-tertiary-fixed text-on-tertiary-fixed rounded-full shadow-sm self-start sm:self-auto shrink-0">
            <span
              className={`inline-flex rounded-full h-2 w-2 bg-tertiary ${running ? "animate-pulse" : ""}`}
            />
            <span className="font-label text-[10px] font-bold uppercase tracking-tighter">
              {statusChip}
            </span>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 lg:p-10 space-y-6 lg:space-y-10 overflow-y-auto no-scrollbar">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-8">
            <section className="lg:col-span-7 bg-surface-container-lowest rounded-2xl p-4 sm:p-6 lg:p-8 min-h-0 shadow-[0px_20px_40px_rgba(25,28,29,0.06)]">
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <h3 className="font-label text-xs uppercase tracking-widest text-secondary mb-1">
                    Controles de Ejecución
                  </h3>
                  <h2 className="font-headline text-2xl sm:text-3xl font-bold text-primary">
                    Panel Maestro
                  </h2>
                </div>
                <div className="hidden sm:flex w-14 h-14 lg:w-16 lg:h-16 rounded-full bg-surface-container-low items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-primary text-2xl lg:text-3xl">
                    precision_manufacturing
                  </span>
                </div>
              </div>

              <div className="mt-6">
                <DateRangeCalendar
                  from={from}
                  to={to}
                  disabled={running}
                  maxDays={31}
                  onChange={(f, t) => {
                    setFrom(f);
                    setTo(t);
                  }}
                />
                <p className="mt-2 text-xs text-secondary opacity-80">
                  Máximo 31 días por ejecución. Se procesa un día por request.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-6 sm:mt-8">
                <button
                  type="button"
                  onClick={onRun}
                  disabled={running}
                  className={`flex flex-col items-center justify-center gap-2 sm:gap-3 bg-gradient-to-br from-primary to-primary-container text-white p-3 sm:p-6 rounded-xl hover:scale-[1.02] transition-all active:scale-95 shadow-lg ${running ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span className="material-symbols-outlined text-2xl sm:text-4xl">
                    play_arrow
                  </span>
                  <span className="font-label text-[9px] sm:text-[11px] font-bold uppercase tracking-widest text-center">
                    Ejecutar
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onDownload}
                  className="flex flex-col items-center justify-center gap-2 sm:gap-3 bg-tertiary-fixed text-on-tertiary-fixed p-3 sm:p-6 rounded-xl hover:brightness-95 transition-all active:scale-95"
                >
                  <span className="material-symbols-outlined text-2xl sm:text-3xl text-tertiary">
                    table_view
                  </span>
                  <span className="font-label text-[9px] sm:text-[11px] font-bold uppercase tracking-widest text-center">
                    Ver Excel
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onStop}
                  disabled={!running}
                  className={`flex flex-col items-center justify-center gap-2 sm:gap-3 bg-error-container text-on-error-container p-3 sm:p-6 rounded-xl hover:brightness-95 transition-all active:scale-95 ${!running ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  <span className="material-symbols-outlined text-2xl sm:text-3xl">stop</span>
                  <span className="font-label text-[9px] sm:text-[11px] font-bold uppercase tracking-widest text-center">
                    Detener
                  </span>
                </button>
              </div>
            </section>

            <section className="lg:col-span-5 bg-surface-container-low rounded-2xl p-4 sm:p-6 lg:p-8 shadow-sm">
              <div className="flex justify-between items-center mb-4 sm:mb-6 gap-3">
                <h3 className="font-label text-xs uppercase tracking-widest text-secondary">
                  Estado del Proceso
                </h3>
                <span className="font-headline font-extrabold text-3xl sm:text-4xl text-primary">
                  {percent}%
                </span>
              </div>
              <div className="w-full bg-surface-container-highest h-3 sm:h-4 rounded-full overflow-hidden">
                <div
                  className="bg-tertiary h-full rounded-full transition-all duration-700"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-4 sm:mt-6 text-sm text-secondary break-words">{summary}</p>
              <p className="mt-2 text-xs text-secondary opacity-80 break-words">{datesText}</p>
            </section>
          </div>

          <section className="w-full">
            <div className="flex items-center justify-between mb-3 sm:mb-4 px-1 sm:px-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <span className="material-symbols-outlined text-primary shrink-0">
                  terminal
                </span>
                <h2 className="font-headline text-base sm:text-lg font-bold text-primary truncate">
                  Terminal SCRAPBO
                </h2>
              </div>
            </div>
            <div className="bg-primary text-tertiary-fixed rounded-2xl p-4 sm:p-6 lg:p-8 min-h-[240px] sm:min-h-[320px] max-h-[50vh] font-mono text-xs sm:text-sm leading-relaxed overflow-auto shadow-2xl">
              <pre className="whitespace-pre-wrap break-words">{consoleText}</pre>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
