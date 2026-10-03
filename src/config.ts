/**
 * Configuración del sistema de avisos de Valencia (AppValencia / viaPublica).
 *
 * Valores extraídos por ingeniería inversa del APK "AppValencia"
 * (es.valencia.lanzadera v2.0.80) y verificados con llamadas reales de lectura.
 *
 * Auth: la app NO usa cuenta de ciudadano. Cada petición lleva
 * `Authorization: Basic YXBwOmFwcA==` (= app:app, público en el APK).
 * La identidad del comunicante es teléfono/email + idDispositivo
 * (se registra con POST /dispositivos y se guarda en local).
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** Base del API municipal (Retrofit baseUrl de la app). */
export const API_BASE =
  process.env.VALENCIA_AVISOS_API_BASE ?? "https://mapas.valencia.es/lanzadera/";

/**
 * Cabecera Authorization de la app (Basic app:app).
 * Sobrescribible por entorno si el Ayuntamiento emite otra.
 */
export const BASIC_AUTH =
  process.env.VALENCIA_AVISOS_BASIC_AUTH ?? "Basic YXBwOmFwcA==";

/** Versión que declara este cliente al registrar el dispositivo. */
export const APP_VERSION = process.env.VALENCIA_AVISOS_APP_VERSION ?? "0.1.0";

/** Geocoder municipal (ArcGIS, sin auth). */
export const GEOCODER_BASE =
  "https://geoportal.valencia.es/server/rest/services/Geocodificadores/Callejero_Municipal/GeocodeServer";

/**
 * Fichero donde vive el perfil del comunicante (contacto, idioma, dispositivo).
 * Se pregunta UNA vez tras la instalación (ver skill) y se reutiliza.
 * Modo 0600: son datos personales.
 */
export const IDENTITY_STORE =
  process.env.VALENCIA_AVISOS_IDENTITY_STORE ??
  join(homedir(), ".config", "valencia-avisos", "identity.json");
