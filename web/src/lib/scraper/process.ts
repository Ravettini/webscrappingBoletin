import { buscarNormasPorFecha } from "./boletin";
import type { PersonaFila } from "./config";
import {
  cruzarResumenConPdf,
  extraerPersonasDeArticulos,
  extraerPersonasDesdeResumen,
} from "./extract";
import { descargarArchivo, esPdf, leerPdfBytes } from "./pdf";

export type DayProcessResult = {
  fecha: string;
  filas: PersonaFila[];
  logs: string[];
};

export async function processDate(fecha: string): Promise<DayProcessResult> {
  const logs: string[] = [];
  const filas: PersonaFila[] = [];
  logs.push(`Procesando fecha: ${fecha}`);

  const normas = await buscarNormasPorFecha(fecha);
  logs.push(`Normas Decreto/Resolución detectadas para ${fecha}: ${normas.length}`);

  for (let i = 0; i < normas.length; i++) {
    const dec = normas[i];
    if (i > 0) {
      // Evita rate-limit del API del boletín en corridas largas.
      await new Promise((r) => setTimeout(r, 400));
    }
    logs.push(`[${i + 1}/${normas.length}] Procesando ${dec.titulo_link} (${dec.fecha})`);
    logs.push(`URL detalle/directa: ${dec.href}`);
    try {
      const personasResumen = extraerPersonasDesdeResumen(dec.resumen_home);
      logs.push(`Personas extraídas del resumen: ${personasResumen.length}`);

      const archivo = await descargarArchivo(dec.href);
      if (!esPdf(archivo.content, archivo.contentType, archivo.contentDisposition)) {
        logs.push(`El recurso no parece PDF: ${dec.titulo_link}`);
        continue;
      }

      const textoPdf = await leerPdfBytes(archivo.content);
      logs.push(`Largo texto PDF: ${textoPdf.length}`);

      const personasPdf = extraerPersonasDeArticulos(textoPdf);
      logs.push(`Personas extraídas del PDF: ${personasPdf.length}`);

      const rows = cruzarResumenConPdf(
        personasResumen,
        personasPdf,
        dec.titulo_link,
        dec.area_home,
      );
      for (const f of rows) {
        f.fecha = dec.fecha;
        filas.push(f);
      }
      logs.push(`Filas finales ${dec.titulo_link}: ${rows.length}`);
    } catch (e) {
      logs.push(`Error procesando ${dec.href}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { fecha, filas, logs };
}
