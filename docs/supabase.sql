-- SCRAPBO — schema de referencia (Supabase / Postgres)
-- Proyecto actual: dyqpgoxeouvsfjemwswu

create extension if not exists "pgcrypto";

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  date_from date not null,
  date_to date not null,
  status text not null
    check (status = any (array[
      'running'::text,
      'completed'::text,
      'failed'::text,
      'cancelled'::text,
      'completed_with_errors'::text
    ])),
  row_count integer not null default 0,
  error text,
  days_ok integer not null default 0,
  days_failed integer not null default 0,
  failed_dates text
);

create table if not exists public.run_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  created_at timestamptz not null default now(),
  fecha text,
  tipo_accion text,
  nombre text,
  apellido text,
  cuil text,
  area text,
  rol text,
  articulo text,
  decreto text,
  contexto text
);

create index if not exists run_results_run_id_idx on public.run_results (run_id);
create index if not exists runs_created_at_idx on public.runs (created_at desc);

alter table public.runs enable row level security;
alter table public.run_results enable row level security;

-- Ajustar policies según si usás anon key o service role.
-- Con service role desde el server no hace falta policy abierta.
