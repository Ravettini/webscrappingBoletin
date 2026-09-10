# SCRAPBO

Scraper del Boletín Oficial de CABA.

Código: carpeta [`web/`](web/) (Next.js).

---

## Objetivo

Dado un rango de fechas, encontrar decretos/resoluciones de **designación** y **aceptación de renuncia**, extraer persona + CUIL + cargo/área, y devolver filas (Excel / base de datos).

---

## Flujo general

```
1. Usuario elige desde/hasta (máx. 31 días)
2. El front pide la lista de fechas
3. Por cada día, el front llama a un endpoint que:
     a. Consulta el boletín de ese día
     b. Filtra normas con palabras clave (designa / renuncia)
     c. Descarga el PDF de cada norma
     d. Extrae personas del PDF y las cruza con el sumario
4. Al terminar, se consolidan las filas → Excel (+ opcional persistencia)
```

La orquestación es **día por día desde el cliente**: cada request procesa un solo día. Así se evita timeouts en corridas largas.

Endpoints relevantes:

| Acción | Request |
|---|---|
| Listar fechas del rango | `POST /api/job/client` `{ action: "dates", from, to }` |
| Procesar un día | `POST /api/job/client` `{ action: "day", fecha: "dd/MM/yyyy" }` |
| Cerrar corrida + Excel | `POST /api/job/client` `{ action: "finalize", rows, from, to, ... }` |

UI principal: [`web/src/app/page.tsx`](web/src/app/page.tsx)  
Procesamiento de un día: [`web/src/lib/scraper/process.ts`](web/src/lib/scraper/process.ts)

---

## Fuente de datos (sin Selenium)

No se abre el browser del boletín. Se usa la API REST pública:

```
GET https://api-restboletinoficial.buenosaires.gob.ar/obtenerBoletin/{dd-MM-yyyy}/true
```

La respuesta trae un árbol de secciones → tipos (Decreto/Resolución) → áreas → normas con:

- `nombre` (ej. `Decreto N° 303`)
- `sumario` (texto corto de la home)
- `url_norma` (download del PDF)

Implementación: [`web/src/lib/scraper/boletin.ts`](web/src/lib/scraper/boletin.ts)

Filtro inicial: solo normas cuyo nombre+sumario contienen keywords (`designa`, `designar`, `renuncia`, `acepta la renuncia`).

---

## Pipeline por norma

Para cada norma candidata del día:

1. **Sumario** → detectar personas del home (renuncia / designa), si el texto lo permite.
2. **PDF** → bajar bytes, verificar magic `%PDF`, extraer texto (`unpdf`).
3. **Artículos resolutivos** → parsear `Artículo N°…` y buscar patrones:
   - `Nombre Apellido (DNI …, CUIL xx-xxxxxxxx-x)`
   - frases `aceptar la renuncia presentada por…` / `designar a…`
4. **Tipo de acción** → se decide con contexto local (antes/después del nombre).  
   Importante: ignorar designaciones **históricas** del CONSIDERANDO (`se designó…`) y quedarse con el acto del artículo.
5. **Cruce sumario ↔ PDF** → si el home nombra a alguien, se busca en el PDF (match flexible de nombre) para enriquecer CUIL/rol/área. Si no hay match de home, se usan las del PDF.
6. **Área / rol** → regex sobre el entorno del nombre (Vicejefatura, Ministerio, Subsecretaría, Gerente Operativo, etc.).

Implementación: [`web/src/lib/scraper/extract.ts`](web/src/lib/scraper/extract.ts)  
PDF: [`web/src/lib/scraper/pdf.ts`](web/src/lib/scraper/pdf.ts)  
Excel: [`web/src/lib/scraper/excel.ts`](web/src/lib/scraper/excel.ts)

### Forma de cada fila

```ts
{
  fecha, tipo_accion,   // "Designa" | "Acepta renuncia"
  nombre, apellido, cuil,
  area, rol, articulo, decreto, contexto
}
```

---

## Persistencia (opcional)

Si hay credenciales de base, al finalizar se guarda:

- **`runs`**: una ejecución (rango, status, conteos, errores por día)
- **`run_results`**: las filas extraídas

Schema de referencia: [`docs/supabase.sql`](docs/supabase.sql)  
Cliente: [`web/src/lib/supabase/`](web/src/lib/supabase/)

El histórico (`/historico`) lista ejecuciones y permite exportar Excel filtrado o consolidado (`GET /api/results/excel`).

---

## Decisiones de diseño

1. **API REST > Selenium** — más estable; el sitio ya expone JSON.
2. **Un día = un request** — rangos largos no se caen por timeout de una sola función.
3. **Reintentos por día** (server + cliente) — la API/PDF a veces falla; no marcar el día OK si explotó.
4. **No confiar solo en el CONSIDERANDO** — ahí aparecen designaciones viejas; los artículos resolutivos son la fuente de verdad del acto.
5. **Sumario ayuda, PDF confirma** — el home trae nombres; el PDF trae CUIL y el texto legal.
6. **Pausas entre normas/días** — evita rate-limit del boletín.

---

## Local

```bash
cd web
npm install
cp .env.example .env.local   # opcional: keys de DB para histórico
npm run dev
```

Sin DB igual corre el scrape y el Excel en memoria/descarga.
