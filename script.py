import io
import re
import time
import json
import logging
import os
import requests
import pdfplumber
import pandas as pd

from selenium import webdriver
from selenium.webdriver.common.by import By


# =========================
# CONFIG
# =========================
HOME_URL = "https://boletinoficial.buenosaires.gob.ar/"
HEADERS = {"User-Agent": "Mozilla/5.0"}

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_XLSX = os.path.join(BASE_DIR, "decretos_cuil.xlsx")
OUTPUT_LOG = "debug_scraping.log"
OUTPUT_JSON = "debug_scraping.json"

SCROLL_TIMES = 10
SCROLL_PAUSE = 1.8
CONTEXT_MIN_CHARS = 1000

SOLO_DECRETOS = []   # Ej: ["Decreto N° 112"]


# =========================
# LOGGING
# =========================
logging.basicConfig(
    filename=OUTPUT_LOG,
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    encoding="utf-8"
)

def log(msg):
    print(msg)
    logging.info(msg)

def log_error(msg):
    print(msg)
    logging.error(msg)


# =========================
# REGEX
# =========================
REGEX_DECRETO_TITULO = re.compile(r"decreto\s*n[°º]\s*\d+", flags=re.IGNORECASE)
REGEX_RESOLUCION_TITULO = re.compile(
    r"resoluci[óo]n\s*(?:n[°º]|nro\.?)\s*\d+(?:/[A-Za-z0-9]+)*",
    flags=re.IGNORECASE,
)

# Nombre completo + DNI + CUIL
REGEX_PERSONA_DNI_CUIL = re.compile(
    r'(?P<nombre>[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\'\-.]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\'\-.]+)+)\s*'
    r'\(DNI\s*[\d\.]+,\s*CUIL\s*(?P<cuil>\d{2}-\d{8}-\d)\)',
    flags=re.IGNORECASE
)

# Artículos
REGEX_ARTICULO = re.compile(
    r'(Artículo\s*(?P<num>\d+)°\s*[\.-]\s*)(?P<texto>.*?)(?=Artículo\s*\d+°|$)',
    flags=re.IGNORECASE | re.DOTALL
)

# Resumen home: renuncia + designa en su reemplazo
REGEX_HOME_RENUNCIA_DESIGNA = re.compile(
    r'acepta la renuncia.*?presentada por\s+(?P<renuncia>[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\'\-.]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\'\-.]+)+)'
    r'.*?designa.*?(?:en su reemplazo a|a)\s+(?P<designa>[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\'\-.]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ\'\-.]+)+)',
    flags=re.IGNORECASE
)

PATRONES_CARGO = [
    r"director(?:a)? general",
    r"director ejecutivo",
    r"secretari(?:o|a)",
    r"subsecretari(?:o|a)",
    r"ministr(?:o|a)",
    r"jefe(?:a)? de gabinete",
    r"jefe(?:a)? de gobierno",
    r"vicejefe(?:a)? de gobierno",
    r"titular de la secretar(?:í|i)a",
    r"titular de la subsecretar(?:í|i)a",
]

PATRONES_AREA = [
    r"(Ministerio de [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)",
    r"(Secretaría de [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)",
    r"(Subsecretaría [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)",
    r"(Dirección General [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)",
    r"(Agencia Gubernamental de Control)",
]


# =========================
# HELPERS
# =========================
def normalizar(txt: str) -> str:
    if not txt:
        return ""
    txt = txt.replace("\xa0", " ")
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n+", "\n", txt)
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt

def split_nombre_apellido(nombre_completo: str):
    partes = normalizar(nombre_completo).split()
    if len(partes) == 1:
        return partes[0], ""
    apellido = partes[-1]
    nombre = " ".join(partes[:-1])
    return nombre, apellido

def normalizar_nombre(nombre: str) -> str:
    return re.sub(r"\s+", " ", nombre.strip().lower())

def cargo_valido(texto: str) -> bool:
    t = texto.lower()
    return any(re.search(p, t, flags=re.IGNORECASE) for p in PATRONES_CARGO)

def extraer_area(texto: str) -> str:
    for patron in PATRONES_AREA:
        m = re.search(patron, texto, flags=re.IGNORECASE)
        if m:
            return normalizar(m.group(1))
    return ""

def iniciar_driver():
    options = webdriver.ChromeOptions()
    headless = os.getenv("HEADLESS", "true").lower() in ("1", "true", "yes")
    if headless:
        options.add_argument("--headless=new")
    else:
        options.add_argument("--start-maximized")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--log-level=3")

    # En Render/Linux suele usarse Chromium en /usr/bin/chromium.
    # En Windows local conviene NO fijar binary_location y dejar que Selenium
    # use el Chrome instalado (o el path provisto por CHROME_BINARY).
    chrome_binary = os.getenv("CHROME_BINARY", "").strip()
    if chrome_binary:
        options.binary_location = chrome_binary
    elif os.path.exists("/usr/bin/chromium"):
        options.binary_location = "/usr/bin/chromium"

    # Dejar que Selenium Manager resuelva/descargue un driver compatible.
    return webdriver.Chrome(options=options)

def hacer_scroll(driver, veces=SCROLL_TIMES, pausa=SCROLL_PAUSE):
    for _ in range(veces):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(pausa)


# =========================
# HOME
# =========================
def extraer_decretos_home(driver):
    resultados = []
    vistos = set()

    links = driver.find_elements(By.TAG_NAME, "a")
    log(f"Links totales en home: {len(links)}")

    for a in links:
        try:
            txt = normalizar(a.text)
            href = a.get_attribute("href") or ""

            if not txt or not href:
                continue

            if REGEX_DECRETO_TITULO.search(txt) or REGEX_RESOLUCION_TITULO.search(txt):
                if href not in vistos:
                    vistos.add(href)

                    resumen = ""
                    area_home = ""
                    try:
                        parent = a.find_element(By.XPATH, "./ancestor::*[self::div or self::li or self::article][1]")
                        resumen = normalizar(parent.text)
                        m_area = re.search(r"(Área\s+[^\n]+)", resumen, flags=re.IGNORECASE)
                        if m_area:
                            area_home = normalizar(m_area.group(1))
                    except:
                        pass

                    resultados.append({
                        "titulo_link": txt,
                        "href": href,
                        "resumen_home": resumen,
                        "area_home": area_home
                    })
        except Exception as e:
            log_error(f"Error leyendo link home: {e}")

    if SOLO_DECRETOS:
        resultados = [r for r in resultados if r["titulo_link"] in SOLO_DECRETOS]

    return resultados

def extraer_personas_desde_resumen(resumen: str):
    resumen = normalizar(resumen)
    salida = []

    m = REGEX_HOME_RENUNCIA_DESIGNA.search(resumen)
    if m:
        ren = normalizar(m.group("renuncia"))
        des = normalizar(m.group("designa"))

        salida.append({
            "tipo_accion": "Acepta renuncia",
            "nombre_completo": ren,
            "contexto": resumen
        })
        salida.append({
            "tipo_accion": "Designa",
            "nombre_completo": des,
            "contexto": resumen
        })

    return salida


# =========================
# DESCARGA DIRECTA
# =========================
def descargar_archivo(url: str):
    log(f"Descargando recurso: {url}")
    r = requests.get(url, headers=HEADERS, timeout=60)
    r.raise_for_status()

    content_type = r.headers.get("Content-Type", "")
    content_disp = r.headers.get("Content-Disposition", "")
    log(f"Content-Type: {content_type}")
    log(f"Content-Disposition: {content_disp}")
    log(f"Tamaño bytes: {len(r.content)}")

    return {
        "content": r.content,
        "content_type": content_type,
        "content_disposition": content_disp
    }

def es_pdf(data: bytes, content_type: str = "", content_disposition: str = "") -> bool:
    if data[:4] == b"%PDF":
        return True
    if "pdf" in (content_type or "").lower():
        return True
    if ".pdf" in (content_disposition or "").lower():
        return True
    return False

def leer_pdf_bytes(data: bytes) -> str:
    texto_paginas = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        log(f"PDF páginas: {len(pdf.pages)}")
        for i, page in enumerate(pdf.pages, start=1):
            txt = page.extract_text() or ""
            texto_paginas.append(txt)
            if i == 1:
                log(f"Primeros 1000 chars PDF pág 1: {normalizar(txt)[:1000]}")
    return normalizar("\n".join(texto_paginas))


# =========================
# EXTRACCIÓN DESDE PDF
# =========================
def extraer_personas_de_articulos(texto: str):
    """
    Devuelve una fila por persona encontrada dentro de artículos,
    con artículo, acción y contexto.
    """
    texto = normalizar(texto)
    filas = []

    articulos = list(REGEX_ARTICULO.finditer(texto))
    log(f"Artículos detectados: {len(articulos)}")

    for art in articulos:
        numero = art.group("num")
        texto_art = normalizar(art.group("texto"))
        texto_art_l = texto_art.lower()

        tipo_accion = None
        if "renuncia" in texto_art_l:
            tipo_accion = "Acepta renuncia"
        elif "designa" in texto_art_l or "designar" in texto_art_l:
            tipo_accion = "Designa"

        if not tipo_accion:
            continue

        matches = list(REGEX_PERSONA_DNI_CUIL.finditer(texto_art))
        log(f"Artículo {numero}: matches persona+DNI+CUIL = {len(matches)}")

        for m in matches:
            nombre_completo = normalizar(m.group("nombre"))
            cuil = normalizar(m.group("cuil"))

            # Asegura al menos ~CONTEXT_MIN_CHARS alrededor del match.
            # (Pre/post se ajustan según el largo disponible para no salirnos del texto.)
            match_len = max(1, m.end() - m.start())
            needed = CONTEXT_MIN_CHARS - match_len
            pre = needed // 2
            post = needed - pre
            left = max(0, m.start() - pre)
            right = min(len(texto_art), m.end() + post)
            contexto = texto_art[left:right]
            contexto = normalizar(contexto)

            if not cargo_valido(texto_art):
                log(f"Artículo {numero}: descartado por cargo no válido -> {nombre_completo}")
                continue

            area = extraer_area(texto_art) or extraer_area(texto)
            nombre, apellido = split_nombre_apellido(nombre_completo)

            filas.append({
                "tipo_accion": tipo_accion,
                "nombre_completo": nombre_completo,
                "nombre": nombre,
                "apellido": apellido,
                "cuil": cuil,
                "area": area,
                "articulo": f"Artículo {numero}",
                "contexto": contexto
            })

    return filas


def cruzar_resumen_con_pdf(personas_resumen, personas_pdf, titulo_decreto):
    """
    Cruza por nombre. Si una persona del resumen aparece en el PDF,
    usa el CUIL/área/artículo del PDF.
    Si no hay resumen, usa directamente lo del PDF.
    """
    filas = []

    pdf_index = {}
    for p in personas_pdf:
        clave = normalizar_nombre(p["nombre_completo"])
        pdf_index.setdefault(clave, []).append(p)

    # 1) si el resumen trae personas, usamos eso como guía
    if personas_resumen:
        for r in personas_resumen:
            clave = normalizar_nombre(r["nombre_completo"])
            candidatos = pdf_index.get(clave, [])

            if not candidatos:
                log(f"No encontré en PDF a: {r['nombre_completo']}")
                continue

            # Elegir el candidato cuya acción coincida
            elegido = None
            for c in candidatos:
                if c["tipo_accion"] == r["tipo_accion"]:
                    elegido = c
                    break

            if elegido is None:
                elegido = candidatos[0]

            filas.append({
                "tipo_accion": r["tipo_accion"],
                "nombre": elegido["nombre"],
                "apellido": elegido["apellido"],
                "cuil": elegido["cuil"],
                "area": elegido["area"],
                "articulo": elegido["articulo"],
                "decreto": titulo_decreto,
                "contexto": r["contexto"]
            })

    else:
        # 2) si no hubo resumen usable, usamos lo que sale del PDF
        for p in personas_pdf:
            filas.append({
                "tipo_accion": p["tipo_accion"],
                "nombre": p["nombre"],
                "apellido": p["apellido"],
                "cuil": p["cuil"],
                "area": p["area"],
                "articulo": p["articulo"],
                "decreto": titulo_decreto,
                "contexto": p["contexto"]
            })

    # dedupe fuerte
    out = []
    vistos = set()
    for f in filas:
        key = (
            f["tipo_accion"],
            f["nombre"],
            f["apellido"],
            f["cuil"],
            f["decreto"],
            f["articulo"]
        )
        if key not in vistos:
            vistos.add(key)
            out.append(f)

    return out


# =========================
# MAIN
# =========================
def main():
    driver = iniciar_driver()
    filas_finales = []
    debug_items = []

    try:
        log("Abriendo home...")
        driver.get(HOME_URL)
        time.sleep(4)

        log("Haciendo scroll...")
        hacer_scroll(driver)

        decretos = extraer_decretos_home(driver)
        log(f"Decretos detectados en home: {len(decretos)}")

        for i, dec in enumerate(decretos, start=1):
            log("=" * 80)
            log(f"[{i}/{len(decretos)}] Procesando {dec['titulo_link']}")
            log(f"URL detalle/directa: {dec['href']}")

            item_debug = {
                "decreto": dec["titulo_link"],
                "url": dec["href"],
                "resumen_home": dec["resumen_home"],
                "personas_resumen": [],
                "personas_pdf": [],
                "filas_finales": 0,
                "error": ""
            }

            try:
                personas_resumen = extraer_personas_desde_resumen(dec["resumen_home"])
                item_debug["personas_resumen"] = personas_resumen
                log(f"Personas extraídas del resumen: {len(personas_resumen)}")

                archivo = descargar_archivo(dec["href"])

                if not es_pdf(archivo["content"], archivo["content_type"], archivo["content_disposition"]):
                    log(f"El recurso no parece PDF: {dec['titulo_link']}")
                    debug_items.append(item_debug)
                    continue

                texto_pdf = leer_pdf_bytes(archivo["content"])
                log(f"Largo texto PDF: {len(texto_pdf)}")

                personas_pdf = extraer_personas_de_articulos(texto_pdf)
                item_debug["personas_pdf"] = personas_pdf
                log(f"Personas extraídas del PDF: {len(personas_pdf)}")

                filas = cruzar_resumen_con_pdf(
                    personas_resumen,
                    personas_pdf,
                    dec["titulo_link"]
                )

                item_debug["filas_finales"] = len(filas)
                log(f"Filas finales decreto {dec['titulo_link']}: {len(filas)}")

                filas_finales.extend(filas)

            except Exception as e:
                item_debug["error"] = str(e)
                log_error(f"Error procesando {dec['href']}: {e}")

            debug_items.append(item_debug)

        with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
            json.dump(debug_items, f, ensure_ascii=False, indent=2)

        df = pd.DataFrame(filas_finales)

        if df.empty:
            log("No encontré registros finales.")
            log(f"Revisá {OUTPUT_LOG} y {OUTPUT_JSON}")
            return

        df = df.drop_duplicates(subset=[
            "tipo_accion", "nombre", "apellido", "cuil", "decreto", "articulo"
        ])
        df = df.sort_values(by=["decreto", "articulo", "tipo_accion", "apellido", "nombre"])

        with pd.ExcelWriter(OUTPUT_XLSX, engine="openpyxl") as writer:
            df[[
                "tipo_accion",
                "nombre",
                "apellido",
                "cuil",
                "area",
                "articulo",
                "decreto",
                "contexto"
            ]].to_excel(writer, sheet_name="resultado", index=False)

            df.to_excel(writer, sheet_name="debug_resultado", index=False)
            pd.DataFrame(debug_items).to_excel(writer, sheet_name="debug_scraping", index=False)

        log(f"Excel generado: {OUTPUT_XLSX}")
        log(f"Filas generadas: {len(df)}")
        log(f"Log: {OUTPUT_LOG}")
        log(f"JSON debug: {OUTPUT_JSON}")

    finally:
        driver.quit()


if __name__ == "__main__":
    main()