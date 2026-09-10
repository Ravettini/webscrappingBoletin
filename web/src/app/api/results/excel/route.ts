import { buildExcelBuffer } from "@/lib/scraper/excel";
import type { PersonaFila } from "@/lib/scraper/config";
import { listAllResults, listRuns } from "@/lib/supabase/runs";

export const runtime = "nodejs";

function toPersonaFila(row: {
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
}): PersonaFila {
  return {
    fecha: row.fecha || "",
    tipo_accion: row.tipo_accion || "",
    nombre: row.nombre || "",
    apellido: row.apellido || "",
    cuil: row.cuil || "",
    area: row.area || "",
    rol: row.rol || "",
    articulo: row.articulo || "",
    decreto: row.decreto || "",
    contexto: row.contexto || "",
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const runId = searchParams.get("run_id") || undefined;

    const rows = await listAllResults({ runId });
    const filas = rows.map(toPersonaFila);
    const buf = await buildExcelBuffer(filas);

    let filename = "scrapbo_historico_consolidado.xlsx";
    if (runId) {
      const runs = await listRuns(100);
      const run = runs.find((r) => r.id === runId);
      if (run) {
        filename = `scrapbo_${run.date_from}_${run.date_to}.xlsx`;
      } else {
        filename = `scrapbo_run_${runId.slice(0, 8)}.xlsx`;
      }
    }

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
