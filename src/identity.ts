/**
 * Perfil del comunicante. La app "AppValencia" no tiene registro ni pide nombre:
 * cada aviso lleva teléfono/email (validados) + idDispositivo (registrado en el
 * servidor y guardado en local). Este MCP hace lo mismo: `set_identity` guarda
 * el perfil en un JSON local (modo 0600) y las tools lo usan por defecto.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { IDENTITY_STORE } from "./config.js";

export type Lang = "es" | "va";

export interface CitizenIdentity {
  /** Teléfono español. Obligatorio si no hay email. */
  userPhone?: string;
  /** Email. Obligatorio si no hay teléfono. */
  userEmail?: string;
  /** Idioma de las comunicaciones. */
  lang: Lang;
  /** Id de dispositivo devuelto por POST /dispositivos (se obtiene con register_device). */
  deviceId?: string;
  /** Token FCM del dispositivo (la app lo usa para el detalle; opcional aquí). */
  fcmToken?: string;
  /** "imei" enviado al registrar (formato Utils.getUniqueID de la app); se reutiliza en cada aviso. */
  imei?: string;
}

// Regex copiados del formulario de la app (NotificarIncidenciaActivity).
const PHONE_RE = /^(\+34|0034|34)?[6789][0-9]{8}$/;
const EMAIL_RE = /^[_A-Za-z0-9-\\+]+(\.[_A-Za-z0-9-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9]+)*(\.[A-Za-z]{2,})$/;

/** Valida un perfil con las mismas reglas del formulario de la app. */
export function validateIdentity(i: CitizenIdentity): string[] {
  const errors: string[] = [];
  const phone = i.userPhone?.trim() ?? "";
  const email = i.userEmail?.trim() ?? "";
  if (!phone && !email) errors.push("Rellena mínimo email o teléfono.");
  if (phone && !PHONE_RE.test(phone)) errors.push("userPhone: introduce un teléfono español válido.");
  if (email && !EMAIL_RE.test(email)) errors.push("userEmail: introduce un email válido.");
  if (i.lang !== "es" && i.lang !== "va") errors.push("lang: 'es' o 'va'.");
  return errors;
}

/** Código numérico de idioma que espera el registro (LocaleUtils.getLangInt). */
export function langInt(lang: Lang): number {
  return lang === "va" ? 2 : 1;
}

export async function loadIdentity(store = IDENTITY_STORE): Promise<CitizenIdentity | null> {
  try {
    const raw = await readFile(store, "utf8");
    return JSON.parse(raw) as CitizenIdentity;
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: CitizenIdentity, store = IDENTITY_STORE): Promise<void> {
  const errors = validateIdentity(identity);
  if (errors.length) throw new Error(`Identidad inválida: ${errors.join(" ")}`);
  await mkdir(dirname(store), { recursive: true });
  await writeFile(store, JSON.stringify(identity, null, 2), { mode: 0o600 });
}
