/**
 * Cliente HTTP de bajo nivel para viaPublica.
 * Auth: `Authorization: Basic ...` en cada petición (como la app).
 * GETs con api=2&lang (Client.get). POSTs form-urlencoded o multipart.
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { API_BASE, BASIC_AUTH, GEOCODER_BASE } from "./config.js";

export class ValenciaApiError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: unknown,
  ) {
    super(`Valencia API ${status} en ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    this.name = "ValenciaApiError";
  }
}

/** Sustituciones habituales fuera de Latin-1 (texto escrito por móvil/IA). */
const LATIN1_SUBS: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201c": '"', "\u201d": '"', "\u201e": '"',
  "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u20ac": "EUR", "\u00a0": " ",
};

/**
 * Texto apto para Latin-1 (lo que el servidor espera en multipart). Los
 * caracteres fuera de Latin-1 se sustituyen (comillas tipográficas, guiones, €),
 * se pasan a su forma base si existe (NFKD) o a "?", en vez de truncarlos como
 * haría writeBytes en la app.
 */
export function toLatin1(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) {
      out += LATIN1_SUBS[ch] ?? ch;
      continue;
    }
    if (LATIN1_SUBS[ch]) {
      out += LATIN1_SUBS[ch];
      continue;
    }
    const base = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    out += base && [...base].every((c) => c.codePointAt(0)! <= 0xff) ? base : "?";
  }
  return out;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export class ValenciaClient {
  /** GET con Basic + api=2&lang (como Client.get de la app). */
  async get<T = unknown>(path: string, lang = "es"): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const url = new URL(`${sep}api=2&lang=${lang}`, new URL(path, API_BASE)).toString();
    const res = await fetch(url, { headers: { Authorization: BASIC_AUTH } });
    const body = await parseBody(res);
    if (!res.ok) throw new ValenciaApiError(res.status, url, body);
    return body as T;
  }

  /** POST form-urlencoded con Basic (como Client.post sin imágenes). */
  async postForm<T = unknown>(path: string, fields: Record<string, string>): Promise<T> {
    const url = new URL(path, API_BASE).toString();
    const body = new URLSearchParams(fields).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: BASIC_AUTH, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
    const parsed = await parseBody(res);
    if (!res.ok) throw new ValenciaApiError(res.status, url, parsed);
    return parsed as T;
  }

  /**
   * POST multipart con Basic (como Client.post con imagen1..N).
   * files: [{field: "imagen1", path: "/tmp/...jpg"}].
   */
  async postMultipart<T = unknown>(
    path: string,
    fields: Record<string, string>,
    files: Array<{ field: string; path: string }> = [],
  ): Promise<T> {
    const url = new URL(path, API_BASE).toString();
    // Multipart a mano, como MultiPartFormOutputStream de la app: escribe los
    // campos con DataOutputStream.writeBytes (un byte por char = Latin-1) y el
    // servidor los decodifica como Latin-1. Con FormData (UTF-8) los acentos
    // llegan rotos ("metálica" -> "metÃ¡lica").
    const boundary = `-------------${Date.now()}`;
    const parts: Buffer[] = [];
    const text = (s: string) => Buffer.from(toLatin1(s), "latin1");
    for (const [k, v] of Object.entries(fields)) {
      parts.push(text(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v ?? ""}\r\n`));
    }
    for (const f of files) {
      const data = await readFile(f.path);
      parts.push(
        text(
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${basename(f.path)}"\r\n` +
            `Content-Type: image/jpeg\r\n\r\n`,
        ),
        data,
        text("\r\n"),
      );
    }
    parts.push(text(`--${boundary}--\r\n`));
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: BASIC_AUTH,
        "Content-Type": `multipart/form-data;boundary=${boundary};charset=UTF-8`,
      },
      body: Buffer.concat(parts),
    });
    const parsed = await parseBody(res);
    if (!res.ok) throw new ValenciaApiError(res.status, url, parsed);
    return parsed as T;
  }

  /** Geocoder municipal (ArcGIS, sin auth). */
  async geocode(query: string): Promise<unknown> {
    const url =
      `${GEOCODER_BASE}/findAddressCandidates` +
      `?SingleLine=${encodeURIComponent(query)}&f=pjson&outSR=4326&maxLocations=5`;
    const res = await fetch(url);
    const body = await parseBody(res);
    if (!res.ok) throw new ValenciaApiError(res.status, url, body);
    return body;
  }
}
