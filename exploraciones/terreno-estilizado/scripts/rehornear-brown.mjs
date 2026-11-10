// Re-hornea las mallas costeras (malla-*.bin.gz) con el worker actual. Usa la costa vectorial ya
// generada (costa-vector-*.json.gz) si la base la tiene; si no, la distancia con signo.
// Uso: node scripts/rehornear-brown.mjs [--completa] [base ...]   (sin bases: todas)
// --completa: también la malla única (solo para depurar y validar la costa; no se versiona).
import fs from "node:fs/promises";
import { bake } from "./brown-bake.mjs";

const root = new URL("../../terreno-nitidez/public/terreno/", import.meta.url);
const args = process.argv.slice(2), completa = args.includes("--completa");
const names = args.filter((a) => !a.startsWith("--"));
const ids = names.length
  ? names
  : JSON.parse(await fs.readFile(new URL("index.json", root))).bases.map((b) => b.id);
for (const id of ids) {
  const dir = new URL(`${id}/`, root);
  const meta = JSON.parse(await fs.readFile(new URL("terreno.json", dir)));
  for (const level of meta.levels) {
    console.log(`— ${id} ${level.name} (superficie REMA continua)`);
    await bake(dir, meta, level, undefined, { completa });
  }
}
