/**
 * Núcleo: funciones de alto nivel sobre viaPublica.
 * Reutilizadas por el servidor MCP y por el CLI.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { APP_VERSION, DEVICE_MODEL } from "./config.js";
import { ValenciaClient } from "./client.js";
import {
  langInt,
  loadIdentity,
  saveIdentity,
  validateIdentity,
  type CitizenIdentity,
} from "./identity.js";
import type { CreateAvisoFromPhotoInput, CreateAvisoInput, CreateFields } from "./types.js";
import {
  downscaleForVision,
  loadPhotoBuffer,
  parsePhoto,
  previewToken,
  resolveUpload,
  saveUpload,
  type PhotoInfo,
} from "./photo.js";

// ---------------------------------------------------------------------------
// Identidad y dispositivo
// ---------------------------------------------------------------------------

export async function getIdentity(): Promise<CitizenIdentity | null> {
  return loadIdentity();
}

export async function setIdentity(identity: CitizenIdentity): Promise<{ saved: boolean }> {
  // Conserva deviceId/fcmToken/imei: re-guardar contacto no debe des-registrar el dispositivo.
  const stored = await loadIdentity();
  await saveIdentity({ ...(stored ?? {}), ...identity });
  return { saved: true };
}

/** Fusiona la identidad guardada con la de la llamada (la llamada manda). */
export async function resolveIdentity(override?: {
  userPhone?: string;
  userEmail?: string;
  lang?: "es" | "va";
}): Promise<CitizenIdentity> {
  const stored = await loadIdentity();
  const merged: CitizenIdentity = {
    userPhone: override?.userPhone ?? stored?.userPhone ?? "",
    userEmail: override?.userEmail ?? stored?.userEmail ?? "",
    lang: override?.lang ?? stored?.lang ?? "es",
    deviceId: stored?.deviceId,
    fcmToken: stored?.fcmToken,
    imei: stored?.imei,
  };
  const errors = validateIdentity(merged);
  if (errors.length) {
    throw new Error(`Falta identidad válida (${errors.join(" ")}). Pídela al humano una vez y guárdala con set_identity.`);
  }
  return merged;
}

/**
 * Registra este cliente como dispositivo (POST /dispositivos).
 * ESCRIBE en el servidor (crea una fila): usar solo con OK humano.
 * Guarda el idDispositivo devuelto en la identidad local.
 */
export async function registerDevice(client: ValenciaClient): Promise<{ deviceId: string }> {
  const stored = (await loadIdentity()) ?? { lang: "es" as const };
  // Desde AppValencia 2.x el servidor responde 400 si `token` va vacío: la app
  // siempre manda un token FCM. Sin Firebase generamos uno con la misma forma
  // (<22 chars>:APA91b<134 chars>) y lo guardamos para reutilizarlo.
  const imei = stored.imei ?? appUniqueId();
  const fcmToken = stored.fcmToken ?? syntheticFcmToken();
  const fields: Record<string, string> = deviceFields({ ...stored, imei, fcmToken });
  const res = await client.postForm<string>("dispositivos", fields);
  const deviceId = String(res ?? "").replace(/\n/g, "").trim();
  if (!deviceId) throw new Error("El servidor no devolvió idDispositivo.");
  await saveIdentity({ ...stored, imei, fcmToken, deviceId });
  return { deviceId };
}

/** Campos de dispositivo que la app añade al registro y a cada aviso (DataLayer/ServerUtilities). */
export function deviceFields(idn: { imei?: string; fcmToken?: string; lang?: "es" | "va" }): Record<string, string> {
  return {
    imei: idn.imei ?? appUniqueId(),
    model: DEVICE_MODEL,
    tipo: "2",
    token: idn.fcmToken ?? "",
    idioma: String(langInt(idn.lang ?? "es")),
    appVersion: APP_VERSION,
  };
}

/** Formato de Utils.getUniqueID: hex(hash(android_id)) en bloques de 4 + sufijo fijo "a32e-6eb2". */
function appUniqueId(): string {
  const h = randomBytes(4).toString("hex");
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-a32e-6eb2`;
}

function syntheticFcmToken(): string {
  const b64 = (n: number, len: number) => randomBytes(n).toString("base64url").slice(0, len);
  return `${b64(20, 22)}:APA91b${b64(120, 134)}`;
}

// ---------------------------------------------------------------------------
// Lectura (sin escritura)
// ---------------------------------------------------------------------------

export interface Subcategory {
  code: string;
  name: string;
}
export interface Category {
  code: string;
  name: string;
  subcategories: Subcategory[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normSub(s: unknown): Subcategory[] {
  const t = (s as { tema?: unknown })?.tema ?? s;
  const list = Array.isArray(t) ? t : t && typeof t === "object" ? Object.values(t) : [];
  return (list as Record<string, unknown>[])
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      code: String(x.temacodigo ?? x.codigo ?? ""),
      name: String(x.temanombrecastellano ?? x.nombre ?? x.temanombre ?? ""),
    }))
    .filter((x) => x.code);
}

export async function listCategories(client: ValenciaClient, lang = "es", withImages = false): Promise<Category[]> {
  const data = (await client.get<any[]>("viaPublica/categorias", lang)) as any[];
  return data.map((c) => ({
    code: String(c.codigo ?? ""),
    name: String(c.nombre ?? ""),
    ...(withImages ? { imagen: c.imagen } : {}),
    subcategories: [...normSub(c.subcategorias), ...((c.codigo ? [{ code: String(c.codigo), name: String(c.nombre ?? "") }] : []) as Subcategory[])],
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Detalle de un código TCOM-xxx (categoría o subcategoría + su grupo). */
export async function getCategory(
  client: ValenciaClient,
  code: string,
  lang = "es",
): Promise<{ group: string; code: string; name: string }> {
  const cats = await listCategories(client, lang);
  for (const c of cats) {
    if (c.code === code) return { group: c.name, code, name: c.name };
    const sub = c.subcategories.find((s) => s.code === code);
    if (sub) return { group: c.name, code, name: sub.name };
  }
  throw new Error(`Código desconocido: ${code}. Mira list_categories.`);
}

const HINT_STOPWORDS = new Set(
  "el la los las un una unos unas en de del al y o con por para que se hay son es esta este esto eso esa ese aqui hay muy mas".split(" "),
);

export interface CategorySuggestion {
  code: string;
  visible_name: string;
  score: number;
}

/** Sugiere códigos TCOM-xxx por palabras del hint. */
export async function suggestCategories(client: ValenciaClient, hint?: string, limit = 5): Promise<CategorySuggestion[]> {
  const cats = await listCategories(client);
  const all: CategorySuggestion[] = [];
  for (const c of cats) {
    for (const s of c.subcategories) {
      all.push({ code: s.code, visible_name: `${c.name} — ${s.name}`, score: 0 });
    }
    if (!c.subcategories.length && c.code) all.push({ code: c.code, visible_name: c.name, score: 0 });
  }
  if (!hint?.trim()) return all.slice(0, limit);
  const words = hint.toLowerCase().split(/[^a-záéíóúñü0-9]+/u).filter((w) => w.length > 2 && !HINT_STOPWORDS.has(w));
  for (const c of all) {
    const name = c.visible_name.toLowerCase();
    for (const w of words) if (name.includes(w)) c.score += 3;
  }
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, limit);
}

/** Geocodifica "calle + número, Valencia" con el callejero municipal. */
export async function geocodeStreet(client: ValenciaClient, query: string): Promise<unknown> {
  const data = (await client.geocode(query.includes(",") ? query : `${query}, Valencia`)) as {
    candidates?: Array<{ address: string; location: { x: number; y: number }; score: number }>;
  };
  return data.candidates ?? data;
}

/** Actuaciones en vía pública (obras, podas…; lectura abierta). */
export async function actuaciones(client: ValenciaClient, lang = "es"): Promise<unknown> {
  return client.get("viaPublica/actuaciones", lang);
}

/** Avisos del dispositivo registrado (requiere register_device previo). */
export async function myAvisos(client: ValenciaClient): Promise<unknown> {
  const stored = await loadIdentity();
  if (!stored?.deviceId) throw new Error("Sin deviceId: ejecuta register_device primero (con OK humano).");
  return client.get(`viaPublica/incidencias?idDispositivo=${encodeURIComponent(stored.deviceId)}`, stored.lang ?? "es");
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

export interface CreateResult {
  dry_run: boolean;
  endpoint: string;
  fields: CreateFields;
  files: string[];
  response?: unknown;
}

/** Construye los campos del POST viaPublica con la forma exacta de la app. */
export async function buildCreateFields(
  input: CreateAvisoInput,
  deviceId: string,
  contact: { phone: string; email: string },
  device?: { imei?: string; fcmToken?: string; lang?: "es" | "va" },
): Promise<CreateFields> {
  return {
    descripcion: input.description,
    telefono: contact.phone,
    direccion: input.address,
    localizacion: `${input.lat} ${input.lon}`,
    correoElectronico: contact.email,
    idDispositivo: deviceId,
    categoria: input.categoria,
    ...deviceFields(device ?? {}),
  };
}

/**
 * Crea un aviso. Por defecto DRY-RUN (no envía nada). Solo con confirm=true
 * hace el POST real (multipart si hay fotos) — un aviso real municipal.
 */
export async function createAviso(client: ValenciaClient, input: CreateAvisoInput): Promise<CreateResult> {
  const idn = await resolveIdentity(input.identity);
  if (!idn.deviceId) throw new Error("Sin deviceId: ejecuta register_device primero (con OK humano).");
  await getCategory(client, input.categoria, idn.lang);
  const endpoint = input.fuente ? "viaPublica/fuentes" : "viaPublica";
  const fields = await buildCreateFields(
    input,
    idn.deviceId,
    { phone: (idn.userPhone ?? "").trim(), email: (idn.userEmail ?? "").trim() },
    idn,
  );
  const files = (input.image_paths ?? []).map((p, i) => ({ field: `imagen${i + 1}`, path: p }));
  if (!input.confirm) {
    return { dry_run: true, endpoint, fields, files: files.map((f) => `${f.field}=${f.path}`) };
  }
  const asRecord: Record<string, string> = { ...fields };
  const response = files.length
    ? await client.postMultipart(endpoint, asRecord, files)
    : await client.postForm(endpoint, asRecord);
  return { dry_run: false, endpoint, fields, files: files.map((f) => `${f.field}=${f.path}`), response };
}

// ---------------------------------------------------------------------------
// Aviso desde foto (fases: categoría, preview; luego envío)
// ---------------------------------------------------------------------------

export type FromPhotoResult =
  | {
      phase: "need_category";
      photo: PhotoInfo;
      gps: { lat: number; lon: number; from: "exif" | "manual" } | null;
      saved_image_path: string;
      suggestions: CategorySuggestion[];
      next: string;
    }
  | {
      phase: "preview";
      preview_token: string;
      photo: PhotoInfo;
      gps: { lat: number; lon: number; from: "exif" | "manual" } | null;
      saved_image_path: string;
      category: unknown;
      fields: CreateFields;
      files: string[];
      description_drafted: boolean;
      image_resized: boolean;
      preview_image_base64: string;
      how_to_confirm: string;
    }
  | {
      phase: "sent";
      fields: CreateFields;
      response: unknown;
      saved_image_path: string;
      next: string;
    };

export async function createAvisoFromPhoto(
  client: ValenciaClient,
  input: import("./types.js").CreateAvisoFromPhotoInput,
): Promise<FromPhotoResult> {
  const buf = await loadPhotoBuffer(input.image_base64, input.image_path, input.file_id);
  const small = downscaleForVision(buf);
  const photo = parsePhoto(small.resized ? small.buffer : buf);
  const saved_image_path = input.image_path ?? (input.file_id ? resolveUpload(input.file_id) : await saveUpload(buf));
  const preview_image_base64 = `data:image/jpeg;base64,${small.buffer.toString("base64")}`;

  const lat = input.lat ?? photo.gps?.lat;
  const lon = input.lon ?? photo.gps?.lng;
  const gps =
    lat !== undefined && lon !== undefined
      ? { lat, lon, from: (input.lat !== undefined ? "manual" : "exif") as "manual" | "exif" }
      : null;

  const idn = await resolveIdentity(input.identity);
  if (!input.categoria) {
    const suggestions = await suggestCategories(client, input.category_hint ?? input.description);
    return {
      phase: "need_category",
      photo,
      gps,
      saved_image_path,
      suggestions,
      next: "Elige un código de suggestions y repite la llamada con categoria. Nada se ha enviado.",
    };
  }
  const category = await getCategory(client, input.categoria, idn.lang);

  if (!input.address || gps === null) {
    throw new Error(
      "Falta ubicación: pasa address (calle y número) + lat/lon" +
        (photo.exif_warning ? ` (nota foto: ${photo.exif_warning})` : "") +
        ". Puedes geocodificar con la tool geocode.",
    );
  }

  let description_drafted = false;
  let description = input.description?.trim();
  if (!description) {
    description_drafted = true;
    const when = photo.taken_at ? ` (foto del ${photo.taken_at})` : "";
    const what = input.category_hint?.trim() ? ` ${input.category_hint.trim()}` : "";
    description = `Incidencia reportada con foto${when}.${what} Revisar descripción antes de enviar.`.trim();
  }

  if (!idn.deviceId) throw new Error("Sin deviceId: ejecuta register_device primero (con OK humano).");
  const fields: CreateFields = {
    descripcion: description,
    telefono: (idn.userPhone ?? "").trim(),
    direccion: input.address,
    localizacion: `${gps.lat} ${gps.lon}`,
    correoElectronico: (idn.userEmail ?? "").trim(),
    idDispositivo: idn.deviceId,
    categoria: input.categoria,
    ...deviceFields(idn),
  };
  const files = [{ field: "imagen1", path: saved_image_path }];
  const endpoint = input.fuente ? "viaPublica/fuentes" : "viaPublica";
  const token = previewToken({ endpoint, fields, files: files.map((f) => f.field) });

  if (!input.confirm) {
    return {
      phase: "preview",
      preview_token: token,
      photo,
      gps,
      saved_image_path,
      category,
      fields,
      files: files.map((f) => `${f.field}=${f.path}`),
      description_drafted,
      image_resized: small.resized,
      preview_image_base64,
      how_to_confirm:
        "MUESTRA este preview al humano y espera su 'sí'. Solo entonces repite la llamada con los MISMOS campos + confirm:true + human_confirmed:true + este preview_token. Si cambias cualquier campo, pide un preview nuevo.",
    };
  }
  if (input.human_confirmed !== true) {
    throw new Error("Envío bloqueado: falta la confirmación humana. Muestra el preview y repite con human_confirmed:true + preview_token.");
  }
  if (input.preview_token !== token) {
    throw new Error("preview_token inválido o desactualizado (algún campo cambió). Repite el preview. Nada se ha enviado.");
  }
  const sent = await createAviso(client, {
    categoria: input.categoria,
    description,
    address: input.address,
    lat: gps.lat,
    lon: gps.lon,
    fuente: input.fuente,
    image_paths: [saved_image_path],
    identity: input.identity,
    confirm: true,
  });
  return { phase: "sent", fields, response: sent.response, saved_image_path, next: "Aviso creado. Compruébalo con my_avisos." };
}
