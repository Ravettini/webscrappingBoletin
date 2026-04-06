import io
import re
import time
import json
import logging
import requests
import pdfplumber
import pandas as pd

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from datetime import date, timedelta
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import ElementNotInteractableException, TimeoutException


# =========================
# CONFIG
# =========================
HOME_URL = "https://boletinoficial.buenosaires.gob.ar/"
HEADERS = {"User-Agent": "Mozilla/5.0"}

OUTPUT_XLSX = "decretos_cuil.xlsx"
OUTPUT_LOG = "debug_scraping.log"
OUTPUT_JSON = "debug_scraping.json"

SCROLL_TIMES = 10
SCROLL_PAUSE = 1.8
CONTEXT_MIN_CHARS = 1000

SOLO_DECRETOS = []   # Ej: ["Decreto N° 112"]
DIAS_SEMANA = 5  # lunes..viernes
PALABRAS_CLAVE_RELEVANTES = ("designa", "designar", "renuncia", "acepta la renuncia")
# Fechas que deben omitirse explícitamente.
EXCLUDED_DATES = {
    "23/03/2026",
    "24/03/2026",
    "02/04/2026",
    "03/04/2026",
}


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

# Fallback: nombre sin DNI/CUIL en textos de designación/renuncia.
# Guion al final de la clase [] para no formar rango inválido (evita error "bad character range").
_NOMBRE_PARTE = r"[A-Za-zÁÉÍÓÚÑáéíóúñ'.-]+"
REGEX_PERSONA_DESIGNA_SIMPLE = re.compile(
    r"(?:designa(?:r)?(?:\s+como\s+[^\.,;:]+)?(?:\s+en\s+su\s+reemplazo)?\s+a\s+)"
    r"(?P<nombre>[A-ZÁÉÍÓÚÑ]" + _NOMBRE_PARTE + r"(?:\s+[A-ZÁÉÍÓÚÑ]" + _NOMBRE_PARTE + r"){1,5})",
    flags=re.IGNORECASE,
)
REGEX_PERSONA_RENUNCIA_SIMPLE = re.compile(
    r"(?:acepta(?:r)?\s+la\s+renuncia(?:\s+presentada)?\s+por\s+)"
    r"(?P<nombre>[A-ZÁÉÍÓÚÑ]" + _NOMBRE_PARTE + r"(?:\s+[A-ZÁÉÍÓÚÑ]" + _NOMBRE_PARTE + r"){1,5})",
    flags=re.IGNORECASE,
)
REGEX_CUIL_GENERIC = re.compile(r"\b(\d{2})\s*-\s*(\d{8})\s*-\s*(\d)\b")
REGEX_CUIL_O_CUIT_ETIQUETA = re.compile(
    r"\b(?:CUIL|CUIT)\s*[:\-]?\s*(\d{2}\s*-\s*\d{8}\s*-\s*\d|\d{11})\b",
    flags=re.IGNORECASE,
)
REGEX_CUIL_11 = re.compile(r"\b(\d{11})\b")

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


def limpiar_nombre_persona(nombre: str) -> str:
    nombre = normalizar(nombre)
    # Quita frases capturadas por fallback no deseadas.
    nombre = re.sub(
        r"^(la|el)\s+renuncia\s+presentada\s+por\s+",
        "",
        nombre,
        flags=re.IGNORECASE,
    )
    # Quita tratamientos/títulos al comienzo.
    nombre = re.sub(
        r"^(la|el)\s+(srta|sr|sra|dra|dr|contadora?|contadora|agente)\.?\s+",
        "",
        nombre,
        flags=re.IGNORECASE,
    )
    nombre = re.sub(r"^(srta|sr|sra|dra|dr)\.?\s+", "", nombre, flags=re.IGNORECASE)
    return normalizar(nombre)


def normalizar_cuil(valor: str) -> str:
    v = normalizar(str(valor or ""))
    if not v:
        return ""
    m = REGEX_CUIL_GENERIC.search(v)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m11 = REGEX_CUIL_11.search(re.sub(r"\D", "", v))
    if m11:
        raw = m11.group(1)
        return f"{raw[:2]}-{raw[2:10]}-{raw[10:]}"
    return ""


def extraer_cuil_desde_texto(texto: str) -> str:
    t = normalizar(texto)
    if not t:
        return ""
    m = REGEX_CUIL_O_CUIT_ETIQUETA.search(t)
    if m:
        return normalizar_cuil(m.group(1))
    m2 = REGEX_CUIL_GENERIC.search(t)
    if m2:
        return f"{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"
    return ""


def extraer_rol_desde_texto(texto: str, nombre: str) -> str:
    t = normalizar(texto)
    if not t:
        return ""

    patrones = [
        r"(?:como|en carácter de|al cargo de|para desempeñarse como)\s+([^,\.;:\n]{8,180})",
        r"\b(Director(?:a)?(?:\s+General)?\s+de\s+[^,\.;:\n]{5,180})",
        r"\b(Subsecretari(?:o|a)\s+de\s+[^,\.;:\n]{5,180})",
        r"\b(Secretari(?:o|a)\s+de\s+[^,\.;:\n]{5,180})",
        r"\b(Ministr(?:o|a)\s+de\s+[^,\.;:\n]{5,180})",
        r"\b(Fiscal(?:\s+General)?\s+[^,\.;:\n]{2,180})",
        r"\b(Responsable\s+Administrativo\s+[^,\.;:\n]{2,180})",
    ]

    if nombre:
        idx = t.lower().find(nombre.lower())
        if idx >= 0:
            win = t[max(0, idx - 120): min(len(t), idx + 260)]
            for p in patrones:
                m = re.search(p, win, flags=re.IGNORECASE)
                if m:
                    return normalizar(m.group(1))

    for p in patrones:
        m = re.search(p, t, flags=re.IGNORECASE)
        if m:
            return normalizar(m.group(1))

    return ""


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
    options = Options()
    options.add_argument("--start-maximized")
    # options.add_argument("--headless=new")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--log-level=3")

    return webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options
    )


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


def get_monday_to_friday_dates(ref: date | None = None):
    """
    Devuelve una lista de fechas (5 items) desde lunes a viernes
    de la semana que contiene `ref` (por defecto: hoy).
    """
    if ref is None:
        ref = date.today()
    # weekday(): lunes=0 ... domingo=6
    monday = ref - timedelta(days=ref.weekday())
    fechas = [monday + timedelta(days=i) for i in range(DIAS_SEMANA)]
    # No incluir días futuros respecto de la fecha de ejecución.
    fechas = [d for d in fechas if d <= ref]
    return [d for d in fechas if d.strftime("%d/%m/%Y") not in EXCLUDED_DATES]


def buscar_normas_por_fecha_exacta(driver, fecha: date):
    """
    Usa el Buscador Histórico (formulario "Buscar por fecha exacta")
    para recuperar links de PDFs correspondientes a decretos/resoluciones.
    """
    fecha_str = fecha.strftime("%d/%m/%Y")

    # Asegura que el formulario esté presente.
    driver.get(HOME_URL)
    try:
        wait = WebDriverWait(driver, 20)
        fecha_input = wait.until(EC.presence_of_element_located((By.ID, "fechaBoletin")))
        wait.until(EC.visibility_of_element_located((By.ID, "fechaBoletin")))
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", fecha_input)
    except TimeoutException:
        # Último recurso: intento directo.
        fecha_input = driver.find_element(By.ID, "fechaBoletin")

    # Algunas veces el input está presente pero no es interactuable.
    try:
        fecha_input.clear()
        fecha_input.send_keys(fecha_str)
    except ElementNotInteractableException:
        # Set por JS para sortear "not interactable".
        driver.execute_script("arguments[0].value = '';", fecha_input)
        driver.execute_script(
            """
            arguments[0].value = arguments[1];
            arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
            arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
            """,
            fecha_input,
            fecha_str,
        )

    form = driver.find_element(By.ID, "formBuscarBoletin")
    # Click en el submit del formulario (con fallback JS).
    try:
        form.find_element(By.XPATH, ".//button[@type='submit']").click()
    except ElementNotInteractableException:
        driver.execute_script("arguments[0].submit();", form)
    time.sleep(5)

    links = driver.find_elements(By.TAG_NAME, "a")
    log(f"Links totales en resultados de {fecha_str}: {len(links)}")

    resultados = []
    vistos = set()
    vistos_norma_fecha = set()

    for a in links:
        try:
            txt = normalizar(a.text)
            href = a.get_attribute("href") or ""
            if not href:
                continue

            parent_text = ""
            try:
                parent = a.find_element(By.XPATH, "./ancestor::*[self::div or self::li or self::article][1]")
                parent_text = normalizar(parent.text)
            except:
                pass

            contenido = normalizar(txt + " " + parent_text)
            if not (REGEX_DECRETO_TITULO.search(contenido) or REGEX_RESOLUCION_TITULO.search(contenido)):
                continue

            if href in vistos:
                continue
            vistos.add(href)

            resumen = parent_text
            resumen_l = resumen.lower()
            if resumen and not any(k in resumen_l for k in PALABRAS_CLAVE_RELEVANTES):
                continue

            area_home = ""
            m_area = re.search(r"(Área\s+[^\n]+)", resumen, flags=re.IGNORECASE) if resumen else None
            if m_area:
                area_home = normalizar(m_area.group(1))

            # Si el link no trae el título completo, usamos el match del regex.
            m_dec = REGEX_DECRETO_TITULO.search(contenido)
            m_res = REGEX_RESOLUCION_TITULO.search(contenido)
            titulo_link = txt
            if (not txt) or (not (m_dec or m_res) ):
                titulo_link = m_dec.group(0) if m_dec else (m_res.group(0) if m_res else txt)
            else:
                # Preferimos el match cuando el link trae solo "PDF"/"Descargar".
                if not REGEX_DECRETO_TITULO.search(txt) and not REGEX_RESOLUCION_TITULO.search(txt):
                    titulo_link = m_dec.group(0) if m_dec else (m_res.group(0) if m_res else txt)

            key_norma_fecha = (normalizar_nombre(titulo_link), fecha_str)
            if key_norma_fecha in vistos_norma_fecha:
                continue
            vistos_norma_fecha.add(key_norma_fecha)

            resultados.append(
                {
                    "titulo_link": titulo_link,
                    "href": href,
                    "resumen_home": resumen,
                    "area_home": area_home,
                    "fecha": fecha_str,
                }
            )
        except Exception as e:
            log_error(f"Error leyendo link de fecha {fecha_str}: {e}")

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
    # Muchos endpoints /download fallan intermitente (500/reset).
    # Reintentamos y probamos variantes http/https.
    variantes = []
    if url.startswith("http://"):
        variantes = [url.replace("http://", "https://", 1), url]
    elif url.startswith("https://"):
        variantes = [url, url.replace("https://", "http://", 1)]
    else:
        variantes = [url]

    last_exc = None
    for u in variantes:
        for intento in range(1, 4):
            try:
                log(f"Descargando recurso (intento {intento}/3): {u}")
                r = requests.get(u, headers=HEADERS, timeout=60)
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
            except Exception as e:
                last_exc = e
                if intento < 3:
                    time.sleep(1.5 * intento)
                else:
                    log_error(f"Fallo descarga {u}: {e}")

    raise last_exc


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

        candidatos = []
        for m in matches:
            candidatos.append((normalizar(m.group("nombre")), normalizar(m.group("cuil")), m.start(), m.end()))

        if not candidatos:
            # Fallback más flexible: intentar nombre sin exigir DNI/CUIL.
            regex_simple = REGEX_PERSONA_RENUNCIA_SIMPLE if tipo_accion == "Acepta renuncia" else REGEX_PERSONA_DESIGNA_SIMPLE
            for m in regex_simple.finditer(texto_art):
                candidatos.append((normalizar(m.group("nombre")), "", m.start("nombre"), m.end("nombre")))
            log(f"Artículo {numero}: matches fallback nombre simple = {len(candidatos)}")

        for nombre_completo, cuil, m_start, m_end in candidatos:
            nombre_completo = limpiar_nombre_persona(nombre_completo)
            if not nombre_completo:
                continue

            # Asegura al menos ~CONTEXT_MIN_CHARS alrededor del match.
            # (Pre/post se ajustan según el largo disponible para no salirnos del texto.)
            match_len = max(1, m_end - m_start)
            needed = CONTEXT_MIN_CHARS - match_len
            pre = needed // 2
            post = needed - pre
            left = max(0, m_start - pre)
            right = min(len(texto_art), m_end + post)
            contexto = texto_art[left:right]
            contexto = normalizar(contexto)
            if not cuil:
                cuil = extraer_cuil_desde_texto(contexto) or extraer_cuil_desde_texto(texto_art)
            cuil = normalizar_cuil(cuil)

            if not cargo_valido(texto_art):
                log(f"Artículo {numero}: descartado por cargo no válido -> {nombre_completo}")
                continue

            area = extraer_area(texto_art) or extraer_area(texto)
            rol = extraer_rol_desde_texto(texto_art, nombre_completo) or extraer_rol_desde_texto(contexto, nombre_completo)
            nombre, apellido = split_nombre_apellido(nombre_completo)

            filas.append({
                "tipo_accion": tipo_accion,
                "nombre_completo": nombre_completo,
                "nombre": nombre,
                "apellido": apellido,
                "cuil": cuil,
                "area": area,
                "rol": rol,
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
                "rol": elegido.get("rol", ""),
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
                "rol": p.get("rol", ""),
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
        fechas_semana = get_monday_to_friday_dates()
        log(f"Buscando lunes..viernes: {[d.strftime('%d/%m/%Y') for d in fechas_semana]}")

        for fecha in fechas_semana:
            log("=" * 80)
            log(f"Procesando fecha: {fecha.strftime('%d/%m/%Y')}")

            normas = buscar_normas_por_fecha_exacta(driver, fecha)
            log(f"Normas Decreto/Resolución detectadas para {fecha.strftime('%d/%m/%Y')}: {len(normas)}")

            for i, dec in enumerate(normas, start=1):
                log("=" * 80)
                log(f"[{i}/{len(normas)}] Procesando {dec['titulo_link']} ({dec.get('fecha')})")
                log(f"URL detalle/directa: {dec['href']}")

                item_debug = {
                    "fecha": dec.get("fecha", ""),
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

                    for f in filas:
                        f["fecha"] = dec.get("fecha", "")

                    item_debug["filas_finales"] = len(filas)
                    log(f"Filas finales {dec['titulo_link']}: {len(filas)}")

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
            "fecha",
            "tipo_accion", "nombre", "apellido", "cuil", "decreto", "articulo"
        ])
        df = df.sort_values(by=["fecha", "decreto", "articulo", "tipo_accion", "apellido", "nombre"])

        with pd.ExcelWriter(OUTPUT_XLSX, engine="openpyxl") as writer:
            df[[
                "fecha",
                "tipo_accion",
                "nombre",
                "apellido",
                "cuil",
                "area",
                "rol",
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

