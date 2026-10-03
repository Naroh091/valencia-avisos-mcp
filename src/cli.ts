#!/usr/bin/env node
/**
 * CLI fino sobre el mismo núcleo, para pruebas manuales.
 * Uso: valencia-avisos <comando> [args]
 *   identity | identity-set [teléfono] [email] [es|va]
 *   register-device                              (ESCRIBE en el servidor: solo con OK humano)
 *   categories [es|va] | category <TCOM-xxx> | geocode <calle...> | actuaciones
 *   my-avisos
 *   create <TCOM-xxx> <lat> <lon> <dirección...> -- <descripción...>   (dry-run; añade --send para enviar)
 *   from-photo <image_path> [TCOM-xxx] [descripción]  (preview; con --send --token <tok> --yes envía)
 *   prep-photo <in.jpg> [out.jpg]
 */
import { readFile, writeFile, stat } from "node:fs/promises";
import { ValenciaClient } from "./client.js";
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
} from "./avisos.js";

import { downscaleForVision, parsePhoto } from "./photo.js";

const client = new ValenciaClient();

function out(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const send = args.includes("--send");
  const rest = args.filter((a) => a !== "--send");

  switch (cmd) {
    case "identity":
      return out((await getIdentity()) ?? { saved: false });
    case "identity-set":
      return out(
        await setIdentity({
          userPhone: rest.find((a) => /^[+]?[0-9]{9,12}$/.test(a)),
          userEmail: rest.find((a) => a.includes("@")),
          lang: (rest.includes("va") ? "va" : "es") as "es" | "va",
        }),
      );
    case "register-device":
      return out(await registerDevice(client));
    case "categories":
      return out(await listCategories(client, rest[0] === "va" ? "va" : "es"));
    case "category":
      return out(await getCategory(client, rest[0]));
    case "geocode":
      return out(await geocodeStreet(client, rest.join(" ")));
    case "actuaciones":
      return out(await actuaciones(client));
    case "my-avisos":
      return out(await myAvisos(client));
    case "create": {
      // create <TCOM> <lat> <lon> <dirección...> -- <descripción...>
      const sep = rest.indexOf("--");
      const head = sep >= 0 ? rest.slice(0, sep) : rest;
      const desc = sep >= 0 ? rest.slice(sep + 1).join(" ") : "";
      const [code, lat, lon, ...addr] = head;
      return out(
        await createAviso(client, {
          categoria: code,
          lat: Number(lat),
          lon: Number(lon),
          address: addr.join(" "),
          description: desc,
          confirm: send,
        }),
      );
    }
    case "from-photo": {
      const tokIdx = rest.indexOf("--token");
      const token = tokIdx >= 0 ? rest[tokIdx + 1] : undefined;
      const yes = rest.includes("--yes");
      const positional = rest.filter((a, i) => {
        if (a === "--send" || a === "--yes" || a === "--token") return false;
        if (tokIdx >= 0 && i === tokIdx + 1) return false;
        return true;
      });
      return out(
        await createAvisoFromPhoto(client, {
          image_path: positional[0],
          categoria: positional[1],
          description: positional[2],
          confirm: send,
          preview_token: token,
          human_confirmed: yes,
        }),
      );
    }
    case "prep-photo": {
      const [input, output] = rest;
      if (!input) {
        console.error("Uso: prep-photo <in.jpg> [out.jpg]");
        process.exit(1);
      }
      const buf = await readFile(input);
      const before = parsePhoto(buf);
      const small = downscaleForVision(buf);
      const dst = output ?? input.replace(/(\.[a-zA-Z0-9]+)?$/, "-ligera$1");
      if (small.resized || dst !== input) await writeFile(dst, small.buffer);
      const stIn = await stat(input);
      const stOut = await stat(dst);
      return out({ ok: true, bytes_in: stIn.size, bytes_out: stOut.size, resized: small.resized, gps: before.gps });
    }
    default:
      console.error(
        "Comandos: identity | identity-set [tlf] [email] [es|va] | register-device | categories | category <TCOM> | geocode <calle> | actuaciones | my-avisos | create <TCOM> <lat> <lon> <dir> -- <desc> [--send] | from-photo <path> [TCOM] [desc] [--send --token <tok> --yes] | prep-photo <in> [out]",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
