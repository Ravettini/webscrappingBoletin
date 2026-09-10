import ExcelJS from "exceljs";
import type { PersonaFila } from "./config";

export async function buildExcelBuffer(filas: PersonaFila[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("resultado");
  ws.columns = [
    { header: "fecha", key: "fecha", width: 14 },
    { header: "tipo_accion", key: "tipo_accion", width: 18 },
    { header: "nombre", key: "nombre", width: 22 },
    { header: "apellido", key: "apellido", width: 18 },
    { header: "cuil", key: "cuil", width: 16 },
    { header: "area", key: "area", width: 28 },
    { header: "rol", key: "rol", width: 28 },
    { header: "articulo", key: "articulo", width: 14 },
    { header: "decreto", key: "decreto", width: 22 },
    { header: "contexto", key: "contexto", width: 60 },
  ];
  for (const f of filas) {
    ws.addRow({
      fecha: f.fecha,
      tipo_accion: f.tipo_accion,
      nombre: f.nombre,
      apellido: f.apellido,
      cuil: f.cuil,
      area: f.area,
      rol: f.rol,
      articulo: f.articulo,
      decreto: f.decreto,
      contexto: f.contexto,
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
