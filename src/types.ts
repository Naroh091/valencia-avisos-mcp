/**
 * Esquemas (zod) de entrada de las herramientas.
 * categoria = código TCOM-xxx de list_categories (p.ej. TCOM-270).
 */
import { z } from "zod";

/** Contacto para una llamada concreta (por defecto, el guardado). */
export const IdentityOverride = z
  .object({
    userPhone: z.string().optional(),
    userEmail: z.string().optional(),
    lang: z.enum(["es", "va"]).optional(),
  })
  .describe("Sobrescribe la identidad guardada solo para esta llamada");

/** Entrada de create_aviso. */
export const CreateAvisoInput = z.object({
  categoria: z.string().describe("código TCOM-xxx de list_categories (p.ej. TCOM-270)"),
  description: z.string().describe("descripción del problema (texto que se publicará)"),
  address: z.string().describe("dirección en texto libre (calle y número)"),
  lat: z.number().describe("latitud WGS84"),
  lon: z.number().describe("longitud WGS84"),
  fuente: z.boolean().optional().describe("true solo para fuentes de agua (usa /fuentes)"),
  image_paths: z.array(z.string()).optional().describe("rutas locales a fotos (se mandan como imagen1..N)"),
  identity: IdentityOverride.optional(),
  confirm: z.boolean().optional().describe("DEBE ser true para ENVIAR de verdad. Por defecto false = dry-run."),
});
export type CreateAvisoInput = z.infer<typeof CreateAvisoInput>;

/** Entrada de create_aviso_from_photo (fases con confirmación humana). */
export const CreateAvisoFromPhotoInput = z.object({
  image_base64: z.string().optional(),
  image_path: z.string().optional().describe("ruta local. Solo stdio/CLI en la máquina del servidor"),
  file_id: z.string().optional().describe("VÍA PREFERIDA en remoto: id de PUT /upload"),
  categoria: z.string().optional().describe("código TCOM-xxx. Si falta, devuelve sugerencias y no crea nada"),
  category_hint: z.string().optional(),
  description: z.string().optional().describe("si falta, se pre-rellena y se marca para revisión"),
  address: z.string().optional(),
  lat: z.number().optional().describe("sobrescribe el GPS EXIF de la foto"),
  lon: z.number().optional().describe("sobrescribe el GPS EXIF de la foto"),
  fuente: z.boolean().optional(),
  identity: IdentityOverride.optional(),
  confirm: z.boolean().optional().describe("true = ENVIAR de verdad (requiere preview_token + human_confirmed)"),
  preview_token: z.string().optional(),
  human_confirmed: z.boolean().optional().describe("el humano vio el preview y dijo 'sí'"),
});
export type CreateAvisoFromPhotoInput = z.infer<typeof CreateAvisoFromPhotoInput>;

/** Campos del POST viaPublica (nombres de DataLayer.postIncidencia). */
export interface CreateFields {
  descripcion: string;
  telefono: string;
  direccion: string;
  /** "lat lon" (Y X), como lo manda la app. */
  localizacion: string;
  correoElectronico: string;
  idDispositivo: string;
  categoria: string;
}
