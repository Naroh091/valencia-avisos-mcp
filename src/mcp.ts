/**
 * Construcción del servidor MCP y registro de tools.
 * Compartido por la entrada stdio (server.ts) y la HTTP (http.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "node:module";
import { z } from "zod";
import { ValenciaClient, ValenciaApiError } from "./client.js";
import {
  actuaciones,
  createAviso,
  createAvisoFromPhoto,
  geocodeStreet,
  getCategory,
  getIdentity,
  listCategories,
  myAvisos,
  registerDevice,
  setIdentity,
  suggestCategories,
} from "./avisos.js";
import { CreateAvisoFromPhotoInput, CreateAvisoInput, IdentityOverride } from "./types.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}
async function run<T>(fn: () => Promise<T>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof ValenciaApiError) return fail(`Error ${e.status}: ${JSON.stringify(e.body)}`);
    return fail(String(e));
  }
}

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PKG_VERSION: string = (require("../package.json") as { version?: string }).version ?? "0.0.0";

export function buildServer(client: ValenciaClient = new ValenciaClient()): McpServer {
  const server = new McpServer({ name: "valencia-avisos", version: PKG_VERSION });

  server.tool(
    "get_identity",
    "Devuelve la identidad del comunicante guardada (contacto, idioma, dispositivo) o null si aún no se preguntó.",
    {},
    () => run(() => getIdentity()),
  );

  server.tool(
    "set_identity",
    "Guarda la identidad del comunicante (se pregunta UNA vez tras la instalación y se reutiliza). Valida: teléfono español o email obligatorios (al menos uno).",
    {
      userPhone: z.string().optional().describe("teléfono español (obligatorio si no hay email)"),
      userEmail: z.string().optional().describe("email (obligatorio si no hay teléfono)"),
      lang: z.enum(["es", "va"]).describe("idioma de las comunicaciones"),
    },
    (input) => run(() => setIdentity(input)),
  );

  server.tool(
    "register_device",
    "Registra este cliente como dispositivo en el Ayuntamiento (POST /dispositivos) y guarda el idDispositivo. ESCRIBE en el servidor: usar solo con OK humano explícito. Necesario antes de crear o consultar avisos.",
    {},
    () => run(() => registerDevice(client)),
  );

  server.tool(
    "list_categories",
    "Categorías y subcategorías de avisos (cada una trae su código TCOM-xxx para crear).",
    { lang: z.enum(["es", "va"]).optional() },
    ({ lang }) => run(() => listCategories(client, lang ?? "es")),
  );

  server.tool(
    "get_category",
    "Detalle de un código TCOM-xxx: grupo, código y nombre.",
    { code: z.string(), lang: z.enum(["es", "va"]).optional() },
    ({ code, lang }) => run(() => getCategory(client, code, lang ?? "es")),
  );

  server.tool(
    "suggest_categories",
    "Sugiere códigos TCOM-xxx por palabras (p.ej. 'contenedor desbordado').",
    { hint: z.string().optional() },
    ({ hint }) => run(() => suggestCategories(client, hint)),
  );

  server.tool(
    "geocode",
    "Calle + número → coordenadas WGS84 con el callejero municipal (p.ej. 'Calle Colón 1, Valencia').",
    { query: z.string() },
    ({ query }) => run(() => geocodeStreet(client, query)),
  );

  server.tool(
    "actuaciones",
    "Actuaciones en vía pública (obras, podas…; lectura abierta, sin registro).",
    { lang: z.enum(["es", "va"]).optional() },
    ({ lang }) => run(() => actuaciones(client, lang ?? "es")),
  );

  server.tool(
    "my_avisos",
    "Avisos del dispositivo registrado (requiere register_device previo).",
    {},
    () => run(() => myAvisos(client)),
  );

  server.tool(
    "create_aviso",
    "Crea un aviso. IMPORTANTE: por defecto es DRY-RUN (confirm=false) y solo devuelve los campos que se enviarían, SIN crear nada. Para crear de verdad hay que pasar confirm=true (requiere deviceId registrado). Usa la identidad guardada salvo 'identity'.",
    CreateAvisoInput.shape,
    (input) => run(() => createAviso(client, input as CreateAvisoInput)),
  );

  server.tool(
    "create_aviso_from_photo",
    "Aviso desde una FOTO en fases. VÍA PREFERIDA: sube la foto con PUT /upload (curl) y pasa file_id; por stdio usa image_path local. Sin categoria → sugiere (need_category). Con categoria pero sin address/coords → error con ayuda (usa geocode). Con todo → preview + preview_token SIN enviar. Envío: MISMOS campos + confirm:true + human_confirmed:true + preview_token (tras 'sí' humano). Sin las tres NO se envía.",
    CreateAvisoFromPhotoInput.shape,
    (input) => run(() => createAvisoFromPhoto(client, input as CreateAvisoFromPhotoInput)),
  );

  return server;
}

export { IdentityOverride };
