import { EXCLUDED_DATES } from "./config";

/** Formato dd/MM/yyyy */
export function formatDateAR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** API usa dd-MM-yyyy */
export function formatDateApi(d: Date): string {
  return formatDateAR(d).replace(/\//g, "-");
}

export function parseDateAR(s: string): Date {
  const [dd, mm, yyyy] = s.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

/** Tope de días por corrida (Hobby / Vercel: 1 día ≈ 1 request). */
export const MAX_RANGE_DAYS = 31;

/** Lunes–viernes de la semana de `ref`, sin futuros ni exclusiones. */
export function getMondayToFridayDates(ref: Date = new Date()): string[] {
  const day = ref.getDay(); // 0=domingo
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(ref.getDate() + mondayOffset);

  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (d > ref) continue;
    const s = formatDateAR(d);
    if (EXCLUDED_DATES.has(s)) continue;
    out.push(s);
  }
  return out;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** ISO yyyy-mm-dd → Date local */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatISODate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export type DateRangeResult =
  | { ok: true; dates: string[] }
  | { ok: false; error: string };

/**
 * Intervalo inclusive desde `from` hasta `to` (ISO yyyy-mm-dd o Date).
 * Omite exclusiones y no pasa de hoy. Máx MAX_RANGE_DAYS.
 */
export function getDatesInRange(
  fromInput: string | Date,
  toInput: string | Date,
  opts?: { maxDays?: number; allowFuture?: boolean },
): DateRangeResult {
  const maxDays = opts?.maxDays ?? MAX_RANGE_DAYS;
  const from =
    typeof fromInput === "string" ? parseISODate(fromInput) : startOfDay(fromInput);
  const to =
    typeof toInput === "string" ? parseISODate(toInput) : startOfDay(toInput);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { ok: false, error: "Fechas inválidas." };
  }
  if (from > to) {
    return { ok: false, error: "La fecha desde no puede ser posterior a hasta." };
  }

  const today = startOfDay(new Date());
  const end = opts?.allowFuture ? to : to > today ? today : to;
  if (from > end) {
    return { ok: false, error: "El intervalo no incluye días disponibles (sin futuros)." };
  }

  const out: string[] = [];
  const cursor = new Date(from);
  while (cursor <= end) {
    const s = formatDateAR(cursor);
    if (!EXCLUDED_DATES.has(s)) out.push(s);
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > maxDays) {
      return {
        ok: false,
        error: `El intervalo supera el máximo de ${maxDays} días (límite Vercel/Hobby).`,
      };
    }
  }

  if (!out.length) {
    return { ok: false, error: "No hay días para scrapear en ese intervalo." };
  }
  return { ok: true, dates: out };
}
