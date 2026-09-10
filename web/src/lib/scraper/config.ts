export const HOME_URL = "https://boletinoficial.buenosaires.gob.ar/";
export const API_BASE = "https://api-restboletinoficial.buenosaires.gob.ar/";
export const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; SCRAPBO/1.0; +https://boletinoficial.buenosaires.gob.ar/)",
  Accept: "application/json, text/plain, */*",
  Origin: "https://boletinoficial.buenosaires.gob.ar",
  Referer: "https://boletinoficial.buenosaires.gob.ar/",
};

export const CONTEXT_MIN_CHARS = 1000;
export const PALABRAS_CLAVE_RELEVANTES = [
  "designa",
  "designar",
  "renuncia",
  "acepta la renuncia",
] as const;

export const EXCLUDED_DATES = new Set([
  "23/03/2026",
  "24/03/2026",
  "02/04/2026",
  "03/04/2026",
]);

export const PATRONES_CARGO = [
  /director(?:a)? general/i,
  /director ejecutivo/i,
  /titular de la direcci[oó]n/i,
  /secretari(?:o|a)/i,
  /subsecretari(?:o|a)/i,
  /ministr(?:o|a)/i,
  /jefe(?:a)? de gabinete/i,
  /jefe(?:a)? de gobierno/i,
  /vicejefe(?:a)? de gobierno/i,
  /vicejefatura/i,
  /titular de la secretar(?:í|i)a/i,
  /titular de la subsecretar(?:í|i)a/i,
  /gerente operativ[oa]/i,
  /subgerente operativ[oa]/i,
  /responsable administrativo/i,
];

export const PATRONES_AREA = [
  /(Vicejefatura de Gobierno)/i,
  /(Jefatura de Gobierno)/i,
  /(Ministerio de [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)/i,
  /(Secretaría de [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)/i,
  /(Subsecretaría [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)/i,
  /(Dirección General [A-ZÁÉÍÓÚÑa-záéíóúñ ]+)/i,
  /(Agencia Gubernamental de Control)/i,
];

export type NormaResumen = {
  titulo_link: string;
  href: string;
  resumen_home: string;
  area_home: string;
  fecha: string;
};

export type PersonaFila = {
  tipo_accion: string;
  nombre: string;
  apellido: string;
  cuil: string;
  area: string;
  rol: string;
  articulo: string;
  decreto: string;
  contexto: string;
  fecha: string;
  nombre_completo?: string;
};
