# SCRAPBO

Scraper del **Boletín Oficial de CABA**. Extrae designaciones y renuncias (con CUIL) desde decretos/resoluciones, genera Excel y guarda histórico en Supabase.

**Producción:** https://scrapbo.vercel.app  
**Código de la app:** carpeta [`web/`](web/)

> El stack viejo (Python/Selenium/Flask/PyInstaller) se eliminó. Todo corre en Next.js sobre Vercel.

---

## Qué hace

1. El usuario elige un intervalo de fechas (máx. 31 días).
2. El navegador orquesta día por día (`POST /api/job/client`).
3. Por cada día se consulta la API REST del boletín, se bajan PDFs, se extraen personas y se cruzan con el sumario.
4. Al finalizar se arma un Excel y se persiste la ejecución + filas en Supabase.
5. En **/historico** se listan ejecuciones y se puede descargar Excel consolidado o por ejecución.

---

## Requisitos

- Node.js 20+
- Cuenta Vercel (deploy)
- Proyecto Supabase (histórico)

---

## Setup local

```bash
cd web
npm install
cp .env.example .env.local
# Completar SUPABASE_URL + SUPABASE_ANON_KEY (o SERVICE_ROLE)
npm run dev
```

Abrir http://localhost:3000

### Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `SUPABASE_URL` | Sí (histórico) | URL del proyecto Supabase |
| `SUPABASE_ANON_KEY` | Sí* | Key server-side (con RLS actual) |
| `SUPABASE_SERVICE_ROLE_KEY` | Recomendada | Preferible a anon en producción |
| `JOB_INTERNAL_SECRET` | Recomendada | Encadenado de jobs server-side |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | No | Persistencia de job entre invocaciones |
| `BLOB_READ_WRITE_TOKEN` | No | Estado + Excel en Vercel Blob |

\* Si no hay Supabase, el scrape y el Excel siguen funcionando; solo no se guarda histórico.

Plantilla: [`web/.env.example`](web/.env.example)

---

## Deploy (Vercel)

Proyecto: **scrapbo** (equipo `nachos-projects`).

```bash
cd web
npx vercel --prod
# Si scrapbo.vercel.app no apunta al deploy nuevo:
npx vercel alias set <url-del-deploy> scrapbo.vercel.app
```

**Importante:** en Settings → Deployment Protection, Vercel Authentication debe estar **off**, si no pide login a quien abra el link.

Dominio a compartir: **https://scrapbo.vercel.app** (no usar `lourbot.vercel.app`).

En Vercel hay que tener las mismas env vars que en `.env.local`.

---

## Supabase

Tablas (RLS on):

### `runs` — una fila por ejecución

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `created_at` / `finished_at` | timestamptz | |
| `date_from` / `date_to` | date | Intervalo scrapeado |
| `status` | text | `completed`, `completed_with_errors`, `failed`, `cancelled`, `running` |
| `row_count` | int | |
| `error` | text | Resumen de fallos |
| `days_ok` / `days_failed` | int | |
| `failed_dates` | text | Fechas fallidas, separadas por coma |

### `run_results` — filas extraídas

| Columna | Tipo |
|---|---|
| `id` | uuid |
| `run_id` | uuid → `runs.id` |
| `fecha`, `tipo_accion`, `nombre`, `apellido`, `cuil` | text |
| `area`, `rol`, `articulo`, `decreto`, `contexto` | text |

SQL de referencia: [`docs/supabase.sql`](docs/supabase.sql)

---

## Arquitectura (resumen)

```
Browser (Dashboard)
  └─ POST /api/job/client  action=dates|day|finalize
       ├─ boletin.ts   → API obtenerBoletin/{dd-MM-yyyy}/true
       ├─ pdf.ts       → download + unpdf
       ├─ extract.ts   → personas / CUIL / área / tipo
       ├─ excel.ts     → ExcelJS
       └─ runs.ts      → Supabase insert

Histórico
  └─ GET /api/runs , /api/results , /api/results/excel
```

Lógica clave de extracción: [`web/src/lib/scraper/extract.ts`](web/src/lib/scraper/extract.ts)  
Orquestación cliente: [`web/src/app/page.tsx`](web/src/app/page.tsx)

---

## Estructura del repo

```
web/                 ← app Next.js (única fuente de verdad)
  src/app/           ← páginas + API routes
  src/components/    ← UI
  src/lib/scraper/   ← boletín, PDF, extracción, Excel
  src/lib/supabase/ ← persistencia
  src/lib/job/       ← job server-side opcional (Redis/Blob)
docs/
  supabase.sql       ← schema de referencia
README.md            ← este archivo
```

---

## Comandos útiles

```bash
cd web
npm run dev      # local
npm run build    # build producción
npm run lint
```

Debug de un día puntual (opcional, recrear script si hace falta):

```bash
cd web
npx tsx -e "import { processDate } from './src/lib/scraper/process.ts'; console.log(await processDate('04/09/2026'))"
```
