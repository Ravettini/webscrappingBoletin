import os
import re
import subprocess
import sys
import threading
import time

from flask import Flask, jsonify, render_template, request, send_file
import traceback

from script import main as run_scraping


app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_XLSX = os.path.join(BASE_DIR, "decretos_cuil.xlsx")
OUTPUT_LOG = os.path.join(BASE_DIR, "debug_scraping.log")
UI_SCRIPT = os.getenv("UI_SCRAPER_SCRIPT", "script2.py")
UI_SCRIPT_PATH = os.path.join(BASE_DIR, UI_SCRIPT)

_job_lock = threading.Lock()
_job_state = {
    "running": False,
    "proc": None,
    "started_at": None,
    "finished_at": None,
    "exit_code": None,
    "error": None,
    "logs": [],
    "dates_seen": [],
}


def _append_log(line: str):
    line = (line or "").rstrip("\n")
    if not line:
        return
    with _job_lock:
        _job_state["logs"].append(line)
        # Mantiene una ventana acotada para no crecer indefinidamente.
        if len(_job_state["logs"]) > 1500:
            _job_state["logs"] = _job_state["logs"][-1500:]

        m = re.search(r"Procesando fecha:\s*(\d{2}/\d{2}/\d{4})", line)
        if m:
            f = m.group(1)
            if f not in _job_state["dates_seen"]:
                _job_state["dates_seen"].append(f)


def _run_ui_job():
    try:
        cmd = [sys.executable, "-u", UI_SCRIPT_PATH]
        proc = subprocess.Popen(
            cmd,
            cwd=BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        with _job_lock:
            _job_state["proc"] = proc

        assert proc.stdout is not None
        for line in proc.stdout:
            _append_log(line)

        code = proc.wait()
        with _job_lock:
            _job_state["exit_code"] = code
            _job_state["running"] = False
            _job_state["finished_at"] = time.time()
            _job_state["proc"] = None
    except Exception as e:
        with _job_lock:
            _job_state["error"] = str(e)
            _job_state["running"] = False
            _job_state["finished_at"] = time.time()
            _job_state["proc"] = None


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.get("/")
def dashboard():
    return render_template("dashboard.html")


@app.post("/ui/run")
def ui_run():
    with _job_lock:
        if _job_state["running"]:
            return jsonify({"ok": False, "error": "Ya hay un proceso en ejecución."}), 409
        _job_state["running"] = True
        _job_state["started_at"] = time.time()
        _job_state["finished_at"] = None
        _job_state["exit_code"] = None
        _job_state["error"] = None
        _job_state["logs"] = [f"Iniciando {UI_SCRIPT}..."]
        _job_state["dates_seen"] = []

    thread = threading.Thread(target=_run_ui_job, daemon=True)
    thread.start()
    return jsonify({"ok": True, "running": True, "script": UI_SCRIPT})


@app.get("/ui/status")
def ui_status():
    offset = request.args.get("offset", default=0, type=int)
    with _job_lock:
        logs = _job_state["logs"]
        total = len(logs)
        if offset < 0:
            offset = 0
        new_logs = logs[offset:] if offset <= total else []
        return jsonify(
            {
                "ok": True,
                "running": _job_state["running"],
                "started_at": _job_state["started_at"],
                "finished_at": _job_state["finished_at"],
                "exit_code": _job_state["exit_code"],
                "error": _job_state["error"],
                "dates_seen": _job_state["dates_seen"],
                "logs": new_logs,
                "next_offset": total,
            }
        )


@app.post("/ui/stop")
def ui_stop():
    with _job_lock:
        proc = _job_state["proc"]
        if not _job_state["running"] or proc is None:
            return jsonify({"ok": False, "error": "No hay proceso en ejecución."}), 409
        try:
            proc.terminate()
            _job_state["logs"].append("Se envió señal de detención al proceso.")
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500


@app.post("/run")
def run_job():
    try:
        run_scraping()
        exists = os.path.exists(OUTPUT_XLSX)
        if not exists:
            log_tail = None
            try:
                if os.path.exists(OUTPUT_LOG):
                    with open(OUTPUT_LOG, "r", encoding="utf-8", errors="ignore") as f:
                        data = f.read()
                        # Tail simple por tamaño (evita depender de terminadores de línea).
                        log_tail = data[-4000:]
            except Exception:
                log_tail = None
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "El scraping terminó pero no generó el archivo Excel esperado.",
                        "expected_file": OUTPUT_XLSX,
                        "exists": False,
                        "log_tail": log_tail,
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
