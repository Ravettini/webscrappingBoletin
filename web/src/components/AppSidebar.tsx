"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Dashboard", icon: "dashboard" },
  { href: "/historico", label: "Histórico", icon: "history" },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const navLinks = links.map((l) => {
    const active =
      l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={() => setOpen(false)}
        className={`flex items-center gap-3 py-3 px-4 rounded-xl transition ${
          active
            ? "bg-white text-primary font-bold shadow-sm"
            : "text-secondary hover:bg-white/60"
        }`}
      >
        <span className="material-symbols-outlined">{l.icon}</span>
        <span className="font-body text-sm">{l.label}</span>
      </Link>
    );
  });

  return (
    <>
      {/* Top bar mobile */}
      <header className="lg:hidden sticky top-0 z-40 bg-surface-container-low border-b border-outline-variant/30 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="font-headline font-extrabold tracking-tighter text-primary text-lg leading-none">
            SCRAPBO
          </p>
          <p className="font-label text-[9px] uppercase tracking-widest text-secondary opacity-70 mt-0.5">
            Scraper Boletín Oficial
          </p>
        </div>
        <button
          type="button"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setOpen((v) => !v)}
          className="p-2 rounded-xl bg-white text-primary shadow-sm"
        >
          <span className="material-symbols-outlined">
            {open ? "close" : "menu"}
          </span>
        </button>
      </header>

      {/* Overlay + drawer mobile */}
      {open && (
        <button
          type="button"
          aria-label="Cerrar menú"
          className="lg:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[min(18rem,85vw)] bg-surface-container-low py-8 px-4 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-8 px-2">
          <h2 className="font-headline font-extrabold tracking-tighter text-primary text-xl">
            SCRAPBO
          </h2>
          <p className="font-label text-[10px] uppercase tracking-widest text-secondary opacity-70">
            Scraper Boletín Oficial
          </p>
        </div>
        <nav className="space-y-1">{navLinks}</nav>
      </aside>

      {/* Sidebar desktop */}
      <aside className="hidden lg:flex flex-col h-screen w-64 bg-surface-container-low py-8 pl-4 sticky top-0 overflow-hidden shrink-0">
        <div className="mb-10 px-4">
          <h2 className="font-headline font-extrabold tracking-tighter text-primary text-xl">
            SCRAPBO
          </h2>
          <p className="font-label text-[10px] uppercase tracking-widest text-secondary opacity-70">
            Scraper Boletín Oficial
          </p>
        </div>
        <nav className="flex-1 space-y-1">{navLinks}</nav>
      </aside>
    </>
  );
}
