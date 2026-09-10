import { HEADERS } from "./config";

function variantesUrl(url: string): string[] {
  if (url.startsWith("http://")) {
    return [url.replace("http://", "https://"), url];
  }
  if (url.startsWith("https://")) {
    return [url, url.replace("https://", "http://")];
  }
  return [url];
}

export async function descargarArchivo(url: string): Promise<{
  content: ArrayBuffer;
  contentType: string;
  contentDisposition: string;
}> {
  let lastError: unknown;
  for (const u of variantesUrl(url)) {
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const res = await fetch(u, {
          headers: HEADERS,
          cache: "no-store",
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const content = await res.arrayBuffer();
        return {
          content,
          contentType: res.headers.get("content-type") || "",
          contentDisposition: res.headers.get("content-disposition") || "",
        };
      } catch (e) {
        lastError = e;
        if (intento < 3) {
          await new Promise((r) => setTimeout(r, 1500 * intento));
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function esPdf(
  data: ArrayBuffer,
  contentType = "",
  contentDisposition = "",
): boolean {
  const bytes = new Uint8Array(data.slice(0, 4));
  const magic = String.fromCharCode(...bytes);
  if (magic === "%PDF") return true;
  if (contentType.toLowerCase().includes("pdf")) return true;
  if (contentDisposition.toLowerCase().includes(".pdf")) return true;
  return false;
}

export async function leerPdfBytes(data: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return normalizarTexto(Array.isArray(text) ? text.join("\n") : String(text || ""));
}

export function normalizarTexto(txt: string): string {
  if (!txt) return "";
  return txt
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}
