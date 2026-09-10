import { list, put } from "@vercel/blob";
import type { PersonaFila } from "@/lib/scraper/config";

export type JobState = {
  running: boolean;
  started_at: number | null;
  finished_at: number | null;
  exit_code: number | null;
  error: string | null;
  logs: string[];
  dates_seen: string[];
  dates_queue: string[];
  date_index: number;
  rows: PersonaFila[];
  cancel: boolean;
  excel_url: string | null;
  excel_b64: string | null;
};

const JOB_KEY = "scrapbo:job";
const BLOB_JOB_PATH = "scrapbo/job-state.json";
const memoryStore = new Map<string, string>();

function hasUpstash() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function hasBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function emptyJob(): JobState {
  return {
    running: false,
    started_at: null,
    finished_at: null,
    exit_code: null,
    error: null,
    logs: [],
    dates_seen: [],
    dates_queue: [],
    date_index: 0,
    rows: [],
    cancel: false,
    excel_url: null,
    excel_b64: null,
  };
}

async function resolveBlobJobUrl(token: string): Promise<string | null> {
  if (process.env.BLOB_JOB_URL) return process.env.BLOB_JOB_URL;
  const cached = memoryStore.get("blob_job_url");
  if (cached) return cached;
  const { blobs } = await list({ prefix: "scrapbo/job-state", token });
  const hit = blobs.find((b) => b.pathname === BLOB_JOB_PATH || b.pathname.endsWith("job-state.json"));
  if (hit) {
    memoryStore.set("blob_job_url", hit.url);
    return hit.url;
  }
  return null;
}

async function readFromBlob(): Promise<JobState | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const url = await resolveBlobJobUrl(token);
  if (!url) return null;
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as JobState;
}

async function writeToBlob(job: JobState): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  const blob = await put(BLOB_JOB_PATH, JSON.stringify(job), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
  memoryStore.set("blob_job_url", blob.url);
}

export async function getJob(): Promise<JobState> {
  if (hasUpstash()) {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const v = await redis.get<JobState | string>(JOB_KEY);
    if (v == null) return emptyJob();
    if (typeof v === "string") {
      try {
        return { ...emptyJob(), ...(JSON.parse(v) as JobState) };
      } catch {
        return emptyJob();
      }
    }
    return { ...emptyJob(), ...v };
  }

  if (hasBlob()) {
    const fromBlob = await readFromBlob();
    if (fromBlob) return { ...emptyJob(), ...fromBlob };
  }

  const raw = memoryStore.get(JOB_KEY);
  if (!raw) return emptyJob();
  try {
    return { ...emptyJob(), ...(JSON.parse(raw) as JobState) };
  } catch {
    return emptyJob();
  }
}

export async function saveJob(job: JobState): Promise<void> {
  const payload = JSON.stringify(job);

  if (hasUpstash()) {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    await redis.set(JOB_KEY, job);
    return;
  }

  if (hasBlob()) {
    await writeToBlob(job);
    memoryStore.set(JOB_KEY, payload);
    return;
  }

  memoryStore.set(JOB_KEY, payload);
}

export async function appendLogs(lines: string[]): Promise<JobState> {
  const job = await getJob();
  job.logs.push(...lines);
  if (job.logs.length > 1500) {
    job.logs = job.logs.slice(-1500);
  }
  await saveJob(job);
  return job;
}
