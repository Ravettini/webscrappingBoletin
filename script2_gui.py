import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from tkinter import messagebox


class Script2GUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Scraper Semanal - Script2")
        self.root.geometry("640x360")
        self.running = False
        self.proc = None
        self.msg_queue = queue.Queue()

        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_path = os.path.join(base_dir, "decretos_cuil.xlsx")
        self.script_path = os.path.join(base_dir, "script2.py")

        self.status_var = tk.StringVar(value="Listo para ejecutar.")

        frame = tk.Frame(root, padx=16, pady=16)
        frame.pack(fill="both", expand=True)

        title = tk.Label(frame, text="Scraper Boletin Oficial", font=("Segoe UI", 16, "bold"))
        title.pack(anchor="w")

        subtitle = tk.Label(
            frame,
            text="Ejecuta script2.py y genera el Excel con los resultados.",
            font=("Segoe UI", 10),
        )
        subtitle.pack(anchor="w", pady=(4, 12))

        self.run_btn = tk.Button(
            frame,
            text="Ejecutar scraping",
            width=22,
            command=self.run_scraping,
            bg="#2563eb",
            fg="white",
            activebackground="#1d4ed8",
            activeforeground="white",
        )
        self.run_btn.pack(anchor="w", pady=(0, 8))

        self.open_btn = tk.Button(
            frame,
            text="Abrir Excel resultado",
            width=22,
            command=self.open_result,
            state="disabled",
        )
        self.open_btn.pack(anchor="w", pady=(0, 12))

        self.stop_btn = tk.Button(
            frame,
            text="Detener proceso",
            width=22,
            command=self.stop_scraping,
            state="disabled",
        )
        self.stop_btn.pack(anchor="w", pady=(0, 12))

        self.status_label = tk.Label(frame, textvariable=self.status_var, font=("Segoe UI", 10))
        self.status_label.pack(anchor="w")

        self.log_box = tk.Text(frame, height=10, wrap="word")
        self.log_box.pack(fill="both", expand=True, pady=(12, 0))
        self.log("Interfaz lista. Presiona 'Ejecutar scraping'.")

        if os.path.exists(self.output_path):
            self.open_btn.config(state="normal")

    def log(self, msg: str):
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        self.root.update_idletasks()

    def set_running_ui(self, running: bool):
        self.running = running
        self.run_btn.config(state="disabled" if running else "normal")
        self.stop_btn.config(state="normal" if running else "disabled")

    def run_scraping(self):
        if self.running:
            return
        if not os.path.exists(self.script_path):
            messagebox.showerror("Error", f"No existe el archivo: {self.script_path}")
            return

        self.set_running_ui(True)
        self.open_btn.config(state="disabled")
        self.status_var.set("Ejecutando scraping... (puede tardar varios minutos)")
        self.log("Iniciando script2.py en proceso separado...")

        thread = threading.Thread(target=self._run_worker_subprocess, daemon=True)
        thread.start()
        self.root.after(200, self._drain_queue)

    def _run_worker_subprocess(self):
        try:
            cmd = [sys.executable, "-u", self.script_path]
            self.proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                cwd=os.path.dirname(self.script_path),
            )

            assert self.proc.stdout is not None
            for line in self.proc.stdout:
                self.msg_queue.put(("log", line.rstrip()))

            code = self.proc.wait()
            self.msg_queue.put(("done", code))
        except Exception as e:
            self.msg_queue.put(("error", str(e)))

    def _drain_queue(self):
        had_done = False
        while True:
            try:
                kind, payload = self.msg_queue.get_nowait()
            except queue.Empty:
                break

            if kind == "log":
                self.log(payload)
            elif kind == "done":
                had_done = True
                if payload == 0:
                    self._on_success()
                else:
                    self._on_error(f"El proceso terminó con código {payload}")
            elif kind == "error":
                had_done = True
                self._on_error(payload)

        if self.running and not had_done:
            self.root.after(200, self._drain_queue)

    def _on_success(self):
        self.proc = None
        self.set_running_ui(False)
        if os.path.exists(self.output_path):
            self.status_var.set(f"Completado. Excel generado: {self.output_path}")
            self.log("Proceso finalizado correctamente.")
            self.open_btn.config(state="normal")
            messagebox.showinfo("OK", "Scraping finalizado y Excel generado.")
        else:
            self.status_var.set("Terminó, pero no se encontro el Excel.")
            self.log("Finalizo sin encontrar el archivo de salida.")
            messagebox.showwarning(
                "Sin archivo",
                "El proceso termino pero no se encontro el Excel. Revisa debug_scraping.log.",
            )

    def _on_error(self, err: str):
        self.proc = None
        self.set_running_ui(False)
        self.status_var.set("Error durante la ejecucion.")
        self.log(f"ERROR: {err}")
        messagebox.showerror("Error", f"Ocurrio un error:\n\n{err}")

    def stop_scraping(self):
        if not self.running or self.proc is None:
            return
        try:
            self.proc.terminate()
            self.status_var.set("Deteniendo proceso...")
            self.log("Solicitud de detencion enviada.")
        except Exception as e:
            self.log(f"No se pudo detener: {e}")

    def open_result(self):
        if not os.path.exists(self.output_path):
            messagebox.showwarning("No encontrado", f"No existe: {self.output_path}")
            return
        os.startfile(self.output_path)


def main():
    root = tk.Tk()
    app = Script2GUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
