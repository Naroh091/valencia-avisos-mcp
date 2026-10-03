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
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    for (const f of files) {
      const data = await readFile(f.path);
      form.set(f.field, new Blob([data], { type: "image/jpeg" }), basename(f.path));
    }
    const res = await fetch(url, { method: "POST", headers: { Authorization: BASIC_AUTH }, body: form });
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
