import os

from flask import Flask, jsonify, send_file
import traceback

from script import main as run_scraping


app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_XLSX = os.path.join(BASE_DIR, "decretos_cuil.xlsx")


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/run")
def run_job():
    try:
        run_scraping()
        exists = os.path.exists(OUTPUT_XLSX)
        if not exists:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "El scraping terminó pero no generó el archivo Excel esperado.",
                        "expected_file": OUTPUT_XLSX,
                        "exists": False,
                    }
                ),
                500,
            )

        return jsonify(
            {
                "ok": True,
                "message": "Scraping ejecutado",
                "file": OUTPUT_XLSX,
                "exists": True,
            }
        )
    except Exception as e:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": str(e),
                    "traceback": traceback.format_exc(),
                }
            ),
            500,
        )


@app.get("/download")
def download_excel():
    if not os.path.exists(OUTPUT_XLSX):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "El archivo no fue generado todavía. Ejecutá primero POST /run.",
                    "file": OUTPUT_XLSX,
                }
            ),
            404,
        )

    return send_file(
        OUTPUT_XLSX,
        as_attachment=True,
        download_name=os.path.basename(OUTPUT_XLSX),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
