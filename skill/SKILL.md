---
name: valencia-avisos
description: "Crea avisos al Ayto. de Valencia desde una foto"
version: 0.1.0
platforms: [linux, macos]
metadata:
  hermes:
    tags: [valencia, avisos, ayuntamiento, incidencias, limpieza, mcp]
    category: civic
---

# Avisos Valencia — incidencias desde una foto

Servidor MCP `valencia-avisos` (11 tools, prefijo `mcp__valencia_avisos__`).
Todo aviso que crees es REAL y lo revisa personal municipal. **Solo incidencias
genuinas. Nada de pruebas.**

## When to Use

Cuando el humano te pasa una foto de una incidencia urbana en Valencia y te pide
generar un aviso al Ayuntamiento. Para esta tarea usa SOLO: inspección de la
imagen + las tools `mcp__valencia_avisos__*`. NO explores la máquina.

## Setup (una sola vez)

La app de Valencia no tiene registro ni pide nombre: cada aviso lleva teléfono
o email + un idDispositivo registrado. Pide UNA vez y guarda con
`mcp__valencia_avisos__set_identity`:

- `lang`: `es` o `va`.
- `userPhone` (móvil/fijo español válido) o `userEmail`: al menos uno.

Comprueba con `get_identity`; si es `null`, pregunta antes de seguir.

## Dispositivo (una sola vez, ESCRIBE en el servidor)

`register_device` registra este cliente en el Ayuntamiento y guarda el
`idDispositivo`. Crea una fila en el servidor: **úsalo solo con OK humano
explícito**. Sin `deviceId` no se puede crear ni consultar. La auth
(`Basic app:app`) ya va en el servidor; no hay que pedir nada más.

## Procedure

### 0. Recibe la foto sin procesarla

NO abras la original con visión: el modelo solo debe verla reducida
(`preview_image_base64`). En stdio local pasa `image_path`; en remoto súbela con
`PUT /upload` y usa el `file_id`; `image_base64` solo para fotos pequeñas ya
visibles. Sin GPS EXIF no adivines: pide ubicación (solo JPEG trae EXIF legible).

### 1. Categoría

Llama `create_aviso_from_photo` con la foto + `category_hint`.

- `phase: "need_category"` → enseña `suggestions` y repite con `categoria`
  (código `TCOM-xxx`, p.ej. `TCOM-270`). Lista en `list_categories`, detalle en
  `get_category`.

### 2. Ubicación

Valencia no tiene selector de portal: la dirección es texto libre + punto GPS.

- Con la foto con GPS, propón calle con `geocode` ("Calle Colón 1, Valencia" →
  candidatos con `address` y `location` x/y) y confirma con el humano.
- Repite con `address` + `lat`/`lon` (WGS84 del candidato).

### 3. Preview (NUNCA envía nada)

Responde `phase: "preview"`. Enséñale al humano: categoría, dirección,
coordenadas, descripción y los campos. Guarda el `preview_token`: ligado al
payload exacto; si cambias CUALQUIER campo, preview nuevo. Si la descripción se
pre-rellenó (`description_drafted: true`), el humano debe revisarla. Mira
`my_avisos` por si ya existe el mismo hecho.

### 4. Envío (solo con el "sí" explícito)

MISMOS campos + `confirm: true` + `human_confirmed: true` + `preview_token`.
Sin las tres, bloquea. Solo `phase: "sent"` acredita el envío. Las fotos viajan
en el mismo POST (`imagen1..N`); no hay adjunto separado.

## Pitfalls

- Sin identidad (`get_identity` → null) o sin `deviceId`: las tools fallan con
  mensaje accionable. No inventes teléfono/email.
- Inventar `categoria`: usa `list_categories`/`suggest_categories` (códigos
  `TCOM-xxx`).
- `localizacion` es `"lat lon"` (en ese orden); no lo inviertas.
- `reverse` del callejero municipal falla en puntos sueltos: usa `geocode` con
  calle + número.
- `register_device` y `create_aviso` con `confirm:true` ESCRIBEN en el
  Ayuntamiento. Lo demás es solo lectura.

## Verification

- `list_categories` → 7 grupos, 30 códigos (sin auth).
- `my_avisos` tras el envío muestra la comunicación.
