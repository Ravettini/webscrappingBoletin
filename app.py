import os

from flask import Flask, jsonify, send_file
import traceback

from script import main as run_scraping


app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/run")
def run_job():
    try:
        run_scraping()
        return jsonify(
            {
                "ok": True,
                "message": "Scraping ejecutado",
                "files": [
                    "decretos_cuil.xlsx",
                    "debug_scraping.log",
                    "debug_scraping.json",
                ],
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
    filename = "decretos_cuil.xlsx"
    output_path = os.path.join(os.getcwd(), filename)

    if not os.path.exists(output_path):
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "El archivo no fue generado todavía. Ejecutá primero POST /run.",
                    "file": filename,
                }
            ),
            404,
        )

    return send_file(
        output_path,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
