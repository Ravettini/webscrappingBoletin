"use client";

import { useMemo, useState } from "react";

type Props = {
  from: string; // yyyy-mm-dd
  to: string;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
  maxDays?: number;
};

const WEEKDAYS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"];

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function iso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysInMonthGrid(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  // Monday-based: JS Sunday=0 → convert
  const weekday = (first.getDay() + 6) % 7;
  const daysCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < weekday; i++) cells.push(null);
  for (let d = 1; d <= daysCount; d++) {
    cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function DateRangeCalendar({
  from,
  to,
  onChange,
  disabled,
  maxDays = 31,
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => startOfMonth(parseISO(to || from)));
  const [picking, setPicking] = useState<"from" | "to">("from");
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const label = `${from.split("-").reverse().join("/")} → ${to.split("-").reverse().join("/")}`;

  function openPicker() {
    if (disabled) return;
    setDraftFrom(from);
    setDraftTo(to);
    setPicking("from");
    setView(startOfMonth(parseISO(from)));
    setOpen(true);
  }

  function apply() {
    onChange(draftFrom, draftTo);
    setOpen(false);
  }

  function onDayClick(day: Date) {
    if (disabled) return;
    if (day > today) return;
    const value = iso(day);

    if (picking === "from") {
      setDraftFrom(value);
      if (parseISO(value) > parseISO(draftTo)) setDraftTo(value);
      setPicking("to");
      return;
    }

    // picking to
    if (parseISO(value) < parseISO(draftFrom)) {
      setDraftFrom(value);
      setDraftTo(draftFrom);
      setPicking("from");
      return;
    }

    const start = parseISO(draftFrom);
    const diff =
      Math.floor((day.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (diff > maxDays) {
      return;
    }
    setDraftTo(value);
  }

  const draftStart = parseISO(draftFrom);
  const draftEnd = parseISO(draftTo);
  const dayCount =
    Math.floor((draftEnd.getTime() - draftStart.getTime()) / (24 * 60 * 60 * 1000)) +
    1;

  const cells = daysInMonthGrid(view);
  const monthLabel = view.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={`w-full flex items-center justify-between gap-3 bg-surface-container-low border border-outline-variant/40 rounded-xl px-4 py-3 text-left hover:brightness-[0.98] transition ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        <div>
          <p className="font-label text-[10px] uppercase tracking-widest text-secondary mb-1">
            Intervalo de fechas
          </p>
          <p className="font-body text-sm text-primary font-medium">{label}</p>
        </div>
        <span className="material-symbols-outlined text-primary">calendar_month</span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div className="fixed z-50 left-4 right-4 top-[50%] -translate-y-1/2 sm:absolute sm:top-auto sm:translate-y-0 sm:mt-2 sm:left-0 sm:right-auto sm:w-[340px] bg-white rounded-2xl shadow-2xl border border-outline-variant/30 p-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                className="p-1 rounded-lg hover:bg-surface-container-low"
                onClick={() => setView(addMonths(view, -1))}
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <p className="font-headline font-bold text-primary capitalize text-sm">
                {monthLabel}
              </p>
              <button
                type="button"
                className="p-1 rounded-lg hover:bg-surface-container-low"
                onClick={() => setView(addMonths(view, 1))}
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>

            <p className="text-xs text-secondary mb-2">
              {picking === "from"
                ? "Elegí la fecha de inicio"
                : "Elegí la fecha de fin"}{" "}
              · máx. {maxDays} días
            </p>

            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="text-center text-[10px] font-label uppercase text-secondary py-1"
                >
                  {w}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} />;
                const value = iso(day);
                const isFuture = day > today;
                const inRange = day >= draftStart && day <= draftEnd;
                const isStart = sameDay(day, draftStart);
                const isEnd = sameDay(day, draftEnd);
                const tooLong =
                  picking === "to" &&
                  day >= draftStart &&
                  Math.floor(
                    (day.getTime() - draftStart.getTime()) / (24 * 60 * 60 * 1000),
                  ) +
                    1 >
                    maxDays;

                return (
                  <button
                    key={value}
                    type="button"
                    disabled={isFuture || tooLong}
                    onClick={() => onDayClick(day)}
                    className={[
                      "h-9 rounded-lg text-sm font-body transition",
                      isFuture || tooLong
                        ? "text-secondary/30 cursor-not-allowed"
                        : "hover:bg-primary/10",
                      inRange ? "bg-tertiary-fixed text-on-tertiary-fixed" : "",
                      isStart || isEnd
                        ? "bg-primary text-white hover:bg-primary"
                        : "",
                    ].join(" ")}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-xs text-secondary break-words">
                {draftFrom.split("-").reverse().join("/")} →{" "}
                {draftTo.split("-").reverse().join("/")} ({dayCount} día
                {dayCount === 1 ? "" : "s"})
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-lg text-secondary hover:bg-surface-container-low"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white font-bold"
                  onClick={apply}
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
