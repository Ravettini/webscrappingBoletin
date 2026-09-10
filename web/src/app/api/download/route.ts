import { getJob } from "@/lib/job/store";

export const runtime = "nodejs";

export async function GET() {
  const job = await getJob();

  if (job.excel_url) {
    return Response.redirect(job.excel_url, 302);
  }

  if (job.excel_b64) {
    const buf = Buffer.from(job.excel_b64, "base64");
    return new Response(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="decretos_cuil.xlsx"',
      },
    });
  }

  return Response.json(
    {
      ok: false,
      error: "El archivo no fue generado todavía. Ejecutá primero el scraping.",
    },
    { status: 404 },
  );
}
