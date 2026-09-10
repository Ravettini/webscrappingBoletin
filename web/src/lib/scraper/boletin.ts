import {
  API_BASE,
  HEADERS,
  PALABRAS_CLAVE_RELEVANTES,
  type NormaResumen,
} from "./config";
import { formatDateApi, parseDateAR } from "./dates";

type NormaLeaf = {
  nombre?: string;
  sumario?: string;
  url_norma?: string;
};

function isTipoNorma(key: string): boolean {
  const t = key.toLowerCase();
  return t.includes("decreto") || t.includes("resoluci");
}

/** Árbol: seccion → tipo (Decreto/Resolución) → área → lista de normas */
function flattenNormas(tree: Record<string, unknown>): Array<
  NormaLeaf & { tipo: string; area: string }
> {
  const out: Array<NormaLeaf & { tipo: string; area: string }> = [];

  for (const seccion of Object.values(tree)) {
    if (!seccion || typeof seccion !== "object") continue;
    for (const [tipo, areas] of Object.entries(seccion as Record<string, unknown>)) {
      if (!isTipoNorma(tipo)) continue;
      if (!areas || typeof areas !== "object") continue;
      for (const [area, items] of Object.entries(areas as Record<string, unknown>)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          const n = item as NormaLeaf;
          if (!n.url_norma) continue;
          out.push({ ...n, tipo, area });
        }
      }
    }
  }
  return out;
}

export async function buscarNormasPorFecha(fechaAR: string): Promise<NormaResumen[]> {
  const apiFecha = formatDateApi(parseDateAR(fechaAR));
  const url = `${API_BASE}obtenerBoletin/${apiFecha}/true`;
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`API obtenerBoletin ${fechaAR}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    normas?: { normas?: Record<string, unknown> };
  };
  const tree = data?.normas?.normas ?? {};
  const flat = flattenNormas(tree);

  const resultados: NormaResumen[] = [];
  const vistos = new Set<string>();

  for (const n of flat) {
    const nombre = (n.nombre || "").trim();
    const sumario = (n.sumario || "").trim();
    const href = (n.url_norma || "").trim();
    if (!href || !nombre) continue;

    const blob = `${nombre} ${sumario}`.toLowerCase();
    if (!PALABRAS_CLAVE_RELEVANTES.some((k) => blob.includes(k))) continue;

    const key = `${nombre.toLowerCase()}|${fechaAR}`;
    if (vistos.has(key)) continue;
    vistos.add(key);

    resultados.push({
      titulo_link: nombre,
      href,
      resumen_home: sumario,
      area_home: n.area || "",
      fecha: fechaAR,
    });
  }

  return resultados;
}
