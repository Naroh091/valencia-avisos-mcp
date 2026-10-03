# valencia-avisos-mcp

Servidor **MCP** (y CLI de apoyo) para el sistema de avisos del Ayuntamiento de
Valencia (AppValencia / viaPublica). Permite a un agente listar categorías,
buscar calles, consultar avisos y crear avisos con inteligencia artificial —
incluso desde una foto. La autenticación (`Basic app:app`) va integrada: es la
de la propia app, pública en el APK.

La finalidad de este proyecto es hacer más fácil que los ciudadanos puedan reportar
problemas al Ayuntamiento de Valencia. Saca una foto de la incidencia (un contenedor
desbordado, una farola apagada, una plaga…), pásasela al agente pidiéndole que genere
un aviso para que describa el problema, seleccione la categoría, añada la ubicación
y lance el aviso al Ayuntamiento.

- [Inicio rápido](#inicio-rápido)
- [Fotos demasiado grandes para el modelo](#fotos-demasiado-grandes-para-el-modelo)
- [¿Eres un agente IA? Lee esto primero](#eres-un-agente-ia-lee-esto-primero)
- [Añadir el MCP vía npx](#añadir-el-mcp-vía-npx)
- [Herramientas MCP](#herramientas-mcp)
- [Configuración](#configuración)
- [Uso como CLI](#uso-como-cli)
- [Servidor HTTP (opcional, avanzado)](#servidor-http-opcional-avanzado)
- [Arquitectura](#arquitectura)

## Inicio rápido

Valencia no usa cuentas: el API acepta la clave fija de la app y cada aviso
lleva el teléfono o email del comunicante más un id de dispositivo registrado.

1. Añade el servidor a tu cliente MCP ([ejemplos](#añadir-el-mcp-vía-npx)) o
   configúralo a mano:

```json
{
  "mcpServers": {
    "valencia-avisos": {
      "command": "npx",
      "args": ["-y", "valencia-avisos-mcp"]
    }
  }
}
```

2. Verifica: `list_categories` debe devolver los 7 grupos (30 códigos `TCOM-xxx`).
3. Pregunta al humano UNA vez su idioma (`es`/`va`) y su teléfono o email;
   guárdalos con la tool `set_identity`. Se reutilizan en todos los avisos.
4. Registra el dispositivo con `register_device` (con OK humano: escribe en el
   Ayuntamiento) y ya puedes crear y consultar.
5. Flujo del agente: `create_aviso_from_photo` (foto → categoría → calle →
   preview) → enseña el preview al humano → `confirm: true` + `human_confirmed: true` +
   `preview_token` solo con su "sí" → comprobación en `my_avisos`.

Todo corre en tu máquina; los avisos se crean con la identidad guardada.

## Fotos demasiado grandes para el modelo

Algunos modelos rechazan fotos muy grandes (`image decode limit exceeded`). El servidor
reduce en TypeScript (sin dependencias) conservando el GPS, así que el modelo nunca
necesita procesar la original:

* **Remoto (HTTP)**: sube la foto con curl y usa el `file_id` (los bytes no pasan por el
  modelo). Requiere el secreto del servidor:
  ```bash
  curl -X PUT --data-binary @foto.jpg \
    -H "Authorization: Bearer ***" \
    'http://127.0.0.1:3001/upload?filename=foto.jpg'
  # → {"file_id":"…","bytes":…}
  ```
  El preview devuelve `preview_image_base64` (copia reducida) para visión y el envío
  usa siempre la original.
* **Local (stdio/CLI)**: pasa `image_path`; el servidor lee y reduce sin que el modelo
  abra el fichero. O reduce tú con `node dist/cli.js prep-photo foto.jpg [foto-ligera.jpg]`.

## ¿Eres un agente IA? Lee esto primero

La skill (`skill/SKILL.md`) no se autoinstala: cópiala al directorio de tu cliente
y abre sesión nueva.

```bash
cp -r skill ~/.hermes/skills/valencia-avisos        # Hermes
cp -r skill ~/.claude/skills/valencia-avisos        # Claude Code
# o descárgala: https://github.com/Naroh091/valencia-avisos-mcp/blob/main/skill/SKILL.md
```

Instálalo así (requiere Node 18+):

1. **Sin credenciales**: este MCP no necesita tokens ni cuentas. Solo idioma +
   teléfono o email del humano (paso 3 del [inicio rápido](#inicio-rápido)).
2. **Instalación** según tu cliente ([comandos exactos](#añadir-el-mcp-vía-npx)):
   Claude Code (`claude mcp add … -- npx -y valencia-avisos-mcp`), Hermes
   (`hermes mcp add … --command npx … --args -y valencia-avisos-mcp`) u OpenClaw
   (`openclaw mcp add … --command npx --arg -y --arg valencia-avisos-mcp`).
3. **Identidad + dispositivo**: pregunta idioma y contacto UNA vez (`set_identity`,
   verifica con `get_identity`) y registra el dispositivo (`register_device`,
   con OK humano porque escribe en el servidor).
4. **Verifica** (`mcp list` / `test` / `doctor --probe` según cliente): debes ver 11 tools.
5. **Uso**: hay skill completa en [`skill/SKILL.md`](skill/SKILL.md).
   Lo esencial: solo incidencias genuinas; `create_aviso_from_photo` en fases
   (categoría → calle → preview → envío solo con "sí" humano + `confirm` +
   `human_confirmed` + `preview_token`); foto por `file_id`; la dirección es texto
   libre y las coordenadas van como `"lat lon"`.

## Añadir el MCP vía npx

Requiere Node 18+.

### Claude Code

```bash
claude mcp add valencia-avisos -- npx -y valencia-avisos-mcp
claude mcp list   # verificar
```

### Hermes

```bash
hermes mcp add valencia-avisos --command npx --args -y valencia-avisos-mcp
hermes mcp test valencia-avisos   # verificar (lista las 11 tools)
```

### OpenClaw

```bash
openclaw mcp add valencia-avisos \
  --command npx \
  --arg -y \
  --arg valencia-avisos-mcp
openclaw mcp doctor valencia-avisos --probe   # verificar
```

### Desde código

```bash
npm install
npm run build
npx -y -p valencia-avisos-mcp valencia-avisos-mcp-http   # HTTP en 127.0.0.1:3001/mcp
```

## Herramientas MCP

| Tool | Qué hace |
|---|---|
| `get_identity` | Identidad guardada (contacto, idioma, dispositivo) o null. |
| `set_identity` | Guarda idioma + teléfono/email (se pregunta una vez). |
| `register_device` | Registra el cliente en el Ayuntamiento (escribe; solo con OK humano). |
| `list_categories` | 7 grupos y 30 códigos `TCOM-xxx`. |
| `get_category` | Detalle de un código (grupo y nombre). |
| `suggest_categories` | Sugiere códigos por palabras. |
| `geocode` | Calle + número → coordenadas con el callejero municipal. |
| `actuaciones` | Actuaciones en vía pública (lectura abierta). |
| `my_avisos` | Avisos del comunicante (por teléfono/email). |
| `create_aviso` | Crea un aviso. **Dry-run por defecto**; `confirm: true` para enviar. |
| `create_aviso_from_photo` | Aviso desde foto en fases: categoría → calle → preview (GPS EXIF) y envío solo con `confirm: true` + `human_confirmed: true` + `preview_token`. Acepta `image_base64`, `image_path` o `file_id`. |

### Seguridad de envío

`create_aviso` es **dry-run por defecto**: devuelve los campos **sin crear nada**. Solo con
`confirm: true` hace el POST real — un aviso real que revisa personal municipal.
Envía únicamente incidencias reales.

`create_aviso_from_photo` exige confirmación humana en fases:

1. **Categoría** (sin `categoria`): sugiere y no envía nada.
2. **Calle** (sin `streetCode`): pide calle/portal y no envía nada.
3. **Preview** (`confirm` ausente/false): GPS EXIF (o `lat`/`lng` manuales),
   payload + `preview_token`. No envía nada.
4. **Envío**: el agente muestra el preview al humano y espera su "sí"; solo entonces
   repite la llamada con los MISMOS campos + `confirm: true` + `human_confirmed: true` +
   `preview_token`. Si cambió cualquier campo, hay que repetir el preview.

## Uso como CLI

```bash
node dist/cli.js categories
node dist/cli.js category TCOM-270
node dist/cli.js geocode "Calle Colón 1, Valencia"
node dist/cli.js actuaciones
node dist/cli.js identity-set 654321987 nombre@example.com es
node dist/cli.js register-device
node dist/cli.js my-avisos
node dist/cli.js create TCOM-270 39.4674 -0.3746 "CARRER COLÓN 1" -- "Contenedor desbordado"          # dry-run
node dist/cli.js create TCOM-270 39.4674 -0.3746 "CARRER COLÓN 1" -- "Contenedor desbordado" --send   # ENVÍA de verdad
node dist/cli.js from-photo foto.jpg TCOM-270 "Contenedor desbordado"      # preview desde foto
node dist/cli.js prep-photo foto.jpg [foto-ligera.jpg]   # reduce para el modelo, conserva EXIF/GPS
```

## Servidor HTTP (opcional)

Por stdio cada uno corre su copia. La entrada **HTTP** sirve para exponer el servidor
que corre en TU máquina para que un agente en OTRA máquina lo use.

```bash
export VALENCIA_AVISOS_MCP_SECRET=<un-secreto-largo>            # exige x-mcp-secret o Bearer
export VALENCIA_AVISOS_ALLOWED_HOSTS=tu-host.tu-tailnet.ts.net  # anti DNS-rebinding
npm run start:http     # 127.0.0.1:3001/mcp
```

Variables: `VALENCIA_AVISOS_HTTP_PORT` (3001), `VALENCIA_AVISOS_HTTP_HOST` (127.0.0.1),
`VALENCIA_AVISOS_HTTP_PATH` (/mcp). Expón solo en red privada (p.ej. `tailscale serve`,
nunca `funnel`). Para persistencia, `launchd`/`pm2`/`tmux` o similar.

## Arquitectura

- `src/client.ts` — Basic + `api=2&lang`, POST form/multipart, geocoder ArcGIS.
- `src/identity.ts` — contacto/idioma/dispositivo en JSON local (0600), con las
  regex del formulario de la app.
- `src/avisos.ts` — **núcleo** (categorías, callejero, actuaciones, mis avisos,
  registro, creación con `descripcion/telefono/direccion/localizacion "lat lon"/
  correoElectronico/idDispositivo/categoria/imagen1..N`).
- `src/photo.ts` — foto: EXIF/GPS, subida a tmp, token de preview.
- `src/types.ts` — esquemas zod de entrada + payload de creación.
- `src/mcp.ts` — `buildServer()`: registra las 11 tools (compartido por stdio y HTTP).
- `src/server.ts` — entrada stdio · `src/http.ts` — entrada HTTP (`/mcp` + `PUT /upload`) · `src/cli.ts` — CLI.

## Notas

- Ingeniería inversa del APK `es.valencia.lanzadera` v2.0.80 + verificación en vivo
  de lecturas y dry-runs (sin crear avisos reales).
