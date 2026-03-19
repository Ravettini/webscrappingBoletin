from flask import Flask, jsonify
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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=10000)
