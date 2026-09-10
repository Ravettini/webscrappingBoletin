import {
  CONTEXT_MIN_CHARS,
  PATRONES_AREA,
  PATRONES_CARGO,
  type PersonaFila,
} from "./config";
import { normalizarTexto } from "./pdf";

const REGEX_PERSONA_DNI_CUIL =
  /([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'\-.]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'\-.]+)+)\s*,?\s*\(DNI\s*[\d.]+,\s*CUIL\s*(\d{2}-\d{8}-\d)\)/g;

const NOMBRE_PARTE = "[A-Za-zÁÉÍÓÚÑáéíóúñ'.-]+";
const REGEX_PERSONA_DESIGNA_SIMPLE = new RegExp(
  `(?:designa(?:r)?(?:\\s+como\\s+[^.,;:]+)?(?:\\s+en\\s+su\\s+reemplazo)?\\s+a\\s+(?:al\\s+agente\\s+)?)([A-ZÁÉÍÓÚÑ]${NOMBRE_PARTE}(?:\\s+[A-ZÁÉÍÓÚÑ]${NOMBRE_PARTE}){1,5})`,
  "g",
);
const REGEX_PERSONA_RENUNCIA_SIMPLE = new RegExp(
  `(?:[Aa]cepta(?:r)?\\s+la\\s+renuncia(?:\\s+presentada)?\\s+por\\s+)([A-ZÁÉÍÓÚÑ]${NOMBRE_PARTE}(?:\\s+[A-ZÁÉÍÓÚÑ]${NOMBRE_PARTE}){1,5})`,
  "g",
);
const REGEX_CUIL_GENERIC = /\b(\d{2})\s*-\s*(\d{8})\s*-\s*(\d)\b/;
const REGEX_CUIL_O_CUIT_ETIQUETA =
  /\b(?:CUIL|CUIT)\s*[:\-]?\s*(\d{2}\s*-\s*\d{8}\s*-\s*\d|\d{11})\b/i;
const REGEX_CUIL_11 = /\b(\d{11})\b/;
/** Solo artículos resolutivos en mayúscula (evita "artículo 14 de la Ley"). */
const REGEX_ARTICULO =
  /((?:Artículo|ARTÍCULO)\s*(\d+)\s*[°ºo]?\s*[.-]?\s*)([\s\S]*?)(?=(?:Artículo|ARTÍCULO)\s*\d+\s*[°ºo]?|$)/g;
const NOMBRE_PERSONA =
  "[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'\\-.]+(?:\\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'\\-.]+){1,5}";
const REGEX_HOME_RENUNCIA_DESIGNA = new RegExp(
  `acepta la renuncia[\\s\\S]*?presentada por\\s+(${NOMBRE_PERSONA})(?:\\s+como\\b|\\s+y\\b|[.,;]|$)[\\s\\S]*?designa[\\s\\S]*?(?:en su reemplazo a|a)\\s+(?:al agente\\s+)?(${NOMBRE_PERSONA})`,
  "i",
);
const REGEX_HOME_RENUNCIA_ONLY = new RegExp(
  `acepta la renuncia[\\s\\S]*?presentada por\\s+(${NOMBRE_PERSONA})`,
  "i",
);

function splitNombreApellido(nombreCompleto: string): [string, string] {
  const partes = normalizarTexto(nombreCompleto).split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return [partes[0] || "", ""];
  return [partes.slice(0, -1).join(" "), partes[partes.length - 1]];
}

function limpiarNombrePersona(nombre: string): string {
  let n = normalizarTexto(nombre);
  n = n.replace(/^(la|el)\s+renuncia\s+presentada\s+por\s+/i, "");
  n = n.replace(/^que\s+(la|el)\s+agente\s+/i, "");
  n = n.replace(/^la\s+designaci[oó]n\s+de\s+(la|el)\s+agente\s+/i, "");
  n = n.replace(/^(al|a la|a el)\s+agente\s+/i, "");
  n = n.replace(/^(la|el)\s+agente\s+/i, "");
  n = n.replace(
    /^(la|el)\s+(srta|sr|sra|dra|dr|se[nñ]ora?|contadora?|contadora|agente)\.?\s+/i,
    "",
  );
  n = n.replace(/^(srta|sr|sra|dra|dr|agente)\.?\s+/i, "");
  n = n.replace(/^de\s+/i, "");
  n = n.replace(/\s+como\b[\s\S]*$/i, "");
  return normalizarTexto(n);
}

function esNombrePersonaValido(nombre: string): boolean {
  const t = normalizarTexto(nombre);
  if (!t) return false;
  const partes = t.split(/\s+/).filter(Boolean);
  if (partes.length < 2 || partes.length > 6) return false;
  if (t.length > 70) return false;
  if (
    /^(los|las|un|una|el|la|de|del|que|como|miembros|designaci)/i.test(t)
  ) {
    return false;
  }
  if (
    /miembros|comisi[oó]n|organismo|presentismo|evaluadora|designaci[oó]n|renuncia/i.test(
      t,
    )
  ) {
    return false;
  }
  return partes.every((p) => /^[A-ZÁÉÍÓÚÑ]/.test(p));
}

/** Match exacto o por inclusión de tokens (evita perder filas por "al agente X"). */
function nombresCoinciden(a: string, b: string): boolean {
  const na = normalizarNombre(limpiarNombrePersona(a));
  const nb = normalizarNombre(limpiarNombrePersona(b));
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = na.split(" ").filter(Boolean);
  const tb = nb.split(" ").filter(Boolean);
  if (ta.length >= 2 && tb.length >= 2) {
    const sa = new Set(ta);
    const overlap = tb.filter((x) => sa.has(x)).length;
    if (overlap >= Math.min(ta.length, tb.length, 3)) return true;
  }
  return false;
}

function normalizarCuil(valor: string): string {
  const v = normalizarTexto(String(valor || ""));
  if (!v) return "";
  const m = v.match(REGEX_CUIL_GENERIC);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const digits = v.replace(/\D/g, "");
  const m11 = digits.match(REGEX_CUIL_11);
  if (m11) {
    const raw = m11[1];
    return `${raw.slice(0, 2)}-${raw.slice(2, 10)}-${raw.slice(10)}`;
  }
  return "";
}

function extraerCuilDesdeTexto(texto: string): string {
  const t = normalizarTexto(texto);
  if (!t) return "";
  const m = t.match(REGEX_CUIL_O_CUIT_ETIQUETA);
  if (m) return normalizarCuil(m[1]);
  const m2 = t.match(REGEX_CUIL_GENERIC);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return "";
}

function cargoValido(texto: string): boolean {
  return PATRONES_CARGO.some((p) => p.test(texto));
}

function extraerArea(texto: string, cercaDe = ""): string {
  const idx = cercaDe ? texto.toLowerCase().indexOf(cercaDe.toLowerCase()) : -1;
  const ventana =
    idx >= 0
      ? texto.slice(Math.max(0, idx - 100), Math.min(texto.length, idx + cercaDe.length + 260))
      : texto;
  for (const p of PATRONES_AREA) {
    const m = ventana.match(p);
    if (m) return normalizarTexto(m[1]);
  }
  if (idx >= 0) {
    for (const p of PATRONES_AREA) {
      const m = texto.match(p);
      if (m) return normalizarTexto(m[1]);
    }
  }
  return "";
}

function detectarTipoAccion(
  textoArt: string,
  start: number,
  end: number,
): string | null {
  const before = textoArt.slice(Math.max(0, start - 140), start).toLowerCase();
  const after = textoArt.slice(end, Math.min(textoArt.length, end + 160)).toLowerCase();
  const low = textoArt.toLowerCase();

  // Mención histórica: "se designó ... a NAME como ..."
  if (
    (/se\s+design[oó]\b/.test(before) || /mediante\s+decreto[\s\S]{0,80}design[oó]/.test(before)) &&
    /^\s*,?\s*como\b/.test(after)
  ) {
    return null;
  }

  if (
    /renuncia\s+presentada\s+por\s*$/.test(before) ||
    /acepta(?:r)?[\s\S]{0,80}renuncia[\s\S]{0,50}$/.test(before)
  ) {
    return "Acepta renuncia";
  }
  if (
    /present[oó]\s+(?:su\s+)?(?:la\s+)?renuncia/.test(after) ||
    /^[\s\S]{0,50}\brenuncia\b/.test(after)
  ) {
    return "Acepta renuncia";
  }
  if (
    /designaci[oó]n\s+de\s+l[ae]\s+agente/.test(before) ||
    /\bdesigna(?:r)?\b/.test(before.slice(-70))
  ) {
    return "Designa";
  }
  if (/\brenuncia\b/.test(low) && !/\bdesigna(?:r)?\b/.test(low)) {
    return "Acepta renuncia";
  }
  if (/\bdesigna(?:r)?\b/.test(low)) return "Designa";
  if (/\brenuncia\b/.test(low)) return "Acepta renuncia";
  return null;
}

function extraerRolDesdeTexto(texto: string, nombre: string): string {
  const t = normalizarTexto(texto);
  if (!t) return "";
  const patrones = [
    /(?:como|en carácter de|al cargo de|para desempeñarse como)\s+([^,.;:\n]{8,180})/i,
    /\b(Director(?:a)?(?:\s+General)?\s+de\s+[^,.;:\n]{5,180})/i,
    /\b(Subsecretari(?:o|a)\s+de\s+[^,.;:\n]{5,180})/i,
    /\b(Secretari(?:o|a)\s+de\s+[^,.;:\n]{5,180})/i,
    /\b(Ministr(?:o|a)\s+de\s+[^,.;:\n]{5,180})/i,
    /\b(Gerente\s+Operativ[oa]\s+[^,.;:\n]{2,180})/i,
    /\b(Fiscal(?:\s+General)?\s+[^,.;:\n]{2,180})/i,
    /\b(Responsable\s+Administrativo\s+[^,.;:\n]{2,180})/i,
  ];
  if (nombre) {
    const idx = t.toLowerCase().indexOf(nombre.toLowerCase());
    if (idx >= 0) {
      const win = t.slice(Math.max(0, idx - 120), Math.min(t.length, idx + 260));
      for (const p of patrones) {
        const m = win.match(p);
        if (m) return normalizarTexto(m[1]);
      }
    }
  }
  for (const p of patrones) {
    const m = t.match(p);
    if (m) return normalizarTexto(m[1]);
  }
  return "";
}

function normalizarNombre(nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, " ");
}

export function extraerPersonasDesdeResumen(resumen: string): Array<{
  tipo_accion: string;
  nombre_completo: string;
  contexto: string;
}> {
  const r = normalizarTexto(resumen);
  const both = r.match(REGEX_HOME_RENUNCIA_DESIGNA);
  if (both) {
    return [
      {
        tipo_accion: "Acepta renuncia",
        nombre_completo: limpiarNombrePersona(both[1]),
        contexto: r,
      },
      {
        tipo_accion: "Designa",
        nombre_completo: limpiarNombrePersona(both[2]),
        contexto: r,
      },
    ];
  }
  const soloRen = r.match(REGEX_HOME_RENUNCIA_ONLY);
  if (soloRen) {
    return [
      {
        tipo_accion: "Acepta renuncia",
        nombre_completo: limpiarNombrePersona(soloRen[1]),
        contexto: r,
      },
    ];
  }
  return [];
}

type PdfPersona = {
  tipo_accion: string;
  nombre_completo: string;
  nombre: string;
  apellido: string;
  cuil: string;
  area: string;
  rol: string;
  articulo: string;
  contexto: string;
};

export function extraerPersonasDeArticulos(texto: string): PdfPersona[] {
  const full = normalizarTexto(texto);
  const articulos = [...full.matchAll(REGEX_ARTICULO)];
  const bloques: Array<{ numero: string; texto: string; soloDni: boolean }> =
    articulos.map((art) => ({
      numero: art[2] || "",
      texto: normalizarTexto(art[3] || ""),
      soloDni: false,
    }));
  // CONSIDERANDO: solo Nombre+(DNI, CUIL) para no inventar filas genéricas.
  bloques.push({ numero: "", texto: full, soloDni: true });

  const filas: PdfPersona[] = [];
  const seen = new Set<string>();
  const personasEnArticulo = new Set<string>();

  for (const bloque of bloques) {
    const textoArt = bloque.texto;
    if (!textoArt) continue;
    const low = textoArt.toLowerCase();
    if (
      !low.includes("renuncia") &&
      !low.includes("designa") &&
      !low.includes("designación") &&
      !low.includes("designacion")
    ) {
      continue;
    }
    if (!cargoValido(textoArt)) continue;

    type Cand = { nombre: string; cuil: string; start: number; end: number };
    const candidatos: Cand[] = [];

    for (const m of textoArt.matchAll(REGEX_PERSONA_DNI_CUIL)) {
      candidatos.push({
        nombre: normalizarTexto(m[1] || ""),
        cuil: normalizarTexto(m[2] || ""),
        start: m.index ?? 0,
        end: (m.index ?? 0) + m[0].length,
      });
    }

    if (!candidatos.length && !bloque.soloDni) {
      for (const m of textoArt.matchAll(REGEX_PERSONA_RENUNCIA_SIMPLE)) {
        const start = m.index ?? 0;
        candidatos.push({
          nombre: normalizarTexto(m[1] || ""),
          cuil: "",
          start,
          end: start + (m[1]?.length || 0),
        });
      }
      for (const m of textoArt.matchAll(REGEX_PERSONA_DESIGNA_SIMPLE)) {
        const start = m.index ?? 0;
        candidatos.push({
          nombre: normalizarTexto(m[1] || ""),
          cuil: "",
          start,
          end: start + (m[1]?.length || 0),
        });
      }
    }

    for (const c of candidatos) {
      const nombreCompleto = limpiarNombrePersona(c.nombre);
      if (!esNombrePersonaValido(nombreCompleto)) continue;

      const tipoAccion = detectarTipoAccion(textoArt, c.start, c.end);
      if (!tipoAccion) continue;

      const matchLen = Math.max(1, c.end - c.start);
      const needed = CONTEXT_MIN_CHARS - matchLen;
      const pre = Math.floor(needed / 2);
      const post = needed - pre;
      const left = Math.max(0, c.start - pre);
      const right = Math.min(textoArt.length, c.end + post);
      const contexto = normalizarTexto(textoArt.slice(left, right));
      let cuil = c.cuil || extraerCuilDesdeTexto(contexto) || extraerCuilDesdeTexto(textoArt);
      cuil = normalizarCuil(cuil);
      if (bloque.soloDni && !cuil) continue;

      const idPersona = cuil || normalizarNombre(nombreCompleto);
      if (bloque.soloDni && personasEnArticulo.has(idPersona)) continue;

      const area =
        extraerArea(contexto, nombreCompleto) ||
        extraerArea(textoArt, nombreCompleto) ||
        extraerArea(full, nombreCompleto);
      const rol =
        extraerRolDesdeTexto(textoArt, nombreCompleto) ||
        extraerRolDesdeTexto(contexto, nombreCompleto);
      const [nombre, apellido] = splitNombreApellido(nombreCompleto);
      const articulo = bloque.numero ? `Artículo ${bloque.numero}` : "";
      const key = `${tipoAccion}|${idPersona}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!bloque.soloDni) personasEnArticulo.add(idPersona);

      filas.push({
        tipo_accion: tipoAccion,
        nombre_completo: nombreCompleto,
        nombre,
        apellido,
        cuil,
        area,
        rol,
        articulo,
        contexto,
      });
    }
  }

  return filas;
}

function pdfToFila(p: PdfPersona, tituloDecreto: string, contexto?: string): PersonaFila {
  return {
    tipo_accion: p.tipo_accion,
    nombre: p.nombre,
    apellido: p.apellido,
    cuil: p.cuil,
    area: p.area,
    rol: p.rol,
    articulo: p.articulo,
    decreto: tituloDecreto,
    contexto: contexto || p.contexto,
    fecha: "",
  };
}

export function cruzarResumenConPdf(
  personasResumen: Array<{ tipo_accion: string; nombre_completo: string; contexto: string }>,
  personasPdf: PdfPersona[],
  tituloDecreto: string,
  areaHome = "",
): PersonaFila[] {
  const filas: PersonaFila[] = [];
  const used = new Set<string>();

  const applyArea = (row: PersonaFila) => {
    if (areaHome && (!row.area || /Hacienda y Finanzas/i.test(row.area))) {
      if (/jefe|vicejef/i.test(areaHome) || !row.area) {
        row.area = areaHome.replace(/^Área\s+/i, "");
      }
    }
    return row;
  };

  if (personasResumen.length) {
    for (const r of personasResumen) {
      const nombreLimpio = limpiarNombrePersona(r.nombre_completo);
      const candidatos = personasPdf.filter((p) =>
        nombresCoinciden(p.nombre_completo, nombreLimpio),
      );
      if (!candidatos.length) continue;
      const elegido =
        candidatos.find((c) => c.tipo_accion === r.tipo_accion) || candidatos[0];
      const row = applyArea(pdfToFila(elegido, tituloDecreto, r.contexto));
      row.tipo_accion = r.tipo_accion;
      filas.push(row);
      used.add(elegido.cuil || normalizarNombre(elegido.nombre_completo));
    }
  }

  for (const p of personasPdf) {
    if (!esNombrePersonaValido(p.nombre_completo)) continue;
    const id = p.cuil || normalizarNombre(p.nombre_completo);
    if (used.has(id)) continue;
    // Si hubo resumen, igual sumar designaciones/renuncias del PDF no listadas en home.
    filas.push(applyArea(pdfToFila(p, tituloDecreto)));
    used.add(id);
  }

  const out: PersonaFila[] = [];
  const seen = new Set<string>();
  for (const f of filas) {
    const key = [f.tipo_accion, f.nombre, f.apellido, f.cuil, f.decreto, f.articulo].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
