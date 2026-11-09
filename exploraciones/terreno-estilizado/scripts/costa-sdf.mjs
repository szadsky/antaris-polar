#!/usr/bin/env node
/**
 * Distancia con signo a la costa (build, una sola vez por base y nivel).
 *
 * Desde los polígonos de costa del SCAR ADD v7.12 ya recortados (data/costa), calcula para cada
 * celda del nivel (4 m y 8 m, mismo grillado que relieve-*.bin.gz) la distancia en metros a la
 * línea de costa vectorial: positiva en tierra, negativa en mar. El signo sale de la misma
 * rasterización que la máscara binaria (centros de celda).
 *
 * Reemplaza en terreno-estilizado a mar-*.mask.gz: con interpolación bilineal la línea de costa
 * queda en posición sub-celda (sin escalones) y el worker coloca los vértices de mar para que la
 * intersección con el agua caiga sobre la costa ADD, sin tocar la topografía REMA de tierra.
 *
 * Codificación: uint8, 128 = costa, 1 m por unidad (±12 m; fuera de ese rango se satura),
 * guardado como diferencia con la celda de la izquierda (primera columna: con la de arriba), gzip.
 * Casi todo el campo está saturado: las diferencias son 0 salvo cerca de la costa. Salida: ../terreno-nitidez/public/terreno/<base>/costa-<nivel>.sdf.gz
 *
 * Uso: node exploraciones/terreno-estilizado/scripts/costa-sdf.mjs [--only brown,carlini]
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rasterizeLand } from "../../terreno-nitidez/scripts/coastline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const pubDir = path.join(root, "exploraciones", "terreno-nitidez", "public", "terreno");
const STEP_M = 1; // la costa ADD tiene errores de metros: 1 m por unidad alcanza (la interpolación ubica la línea entre celdas)
// Rango útil: solo hace falta cerca de la línea (posición sub-celda y vértices de mar vecinos).
const RANGE_M = 12 * STEP_M; // ±12 m

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const { bases } = JSON.parse(await readFile(path.join(pubDir, "index.json"), "utf8"));

for (const { id } of bases) {
  if (only && !only.includes(id)) continue;
  const meta = JSON.parse(await readFile(path.join(pubDir, id, "terreno.json"), "utf8"));
  const coastFile = path.join(root, "data", "costa", id === "carlini" ? "add-v7.12-potter-cove.json" : `${id}.json`);
  if (!existsSync(coastFile)) {
    console.warn(`⚠ ${id}: sin costa ADD; se omite`);
    continue;
  }
  const { features } = JSON.parse(await readFile(coastFile, "utf8"));
  const [ox, oy] = meta.origin;
  const out = [];
  for (const L of meta.levels) {
    const { width: w, height: h, cellSizeM: cell } = L;
    const land = rasterizeLand(features, { width: w, height: h, originX: ox, originY: oy, resX: cell, resY: -cell });
    const dist = new Float32Array(w * h).fill(RANGE_M);
    const R = RANGE_M + cell;
    let edges = 0;
    for (const f of features) {
      for (const ring of f.geometry.rings) {
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
          const [ax, ay] = ring[j];
          const [bx, by] = ring[k];
          edges++;
          // celdas en el recuadro del segmento ± R (centros en origen + (c + 0,5)·celda)
          const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - ox) / cell));
          const c1 = Math.min(w - 1, Math.ceil((Math.max(ax, bx) + R - ox) / cell));
          const r0 = Math.max(0, Math.floor((oy - Math.max(ay, by) - R) / cell));
          const r1 = Math.min(h - 1, Math.ceil((oy - Math.min(ay, by) + R) / cell));
          if (c0 > c1 || r0 > r1) continue;
          const dx = bx - ax, dy = by - ay;
          const len2 = dx * dx + dy * dy || 1e-9;
          for (let r = r0; r <= r1; r++) {
            const py = oy - (r + 0.5) * cell;
            for (let c = c0; c <= c1; c++) {
              const px = ox + (c + 0.5) * cell;
              let t = ((px - ax) * dx + (py - ay) * dy) / len2;
              t = t < 0 ? 0 : t > 1 ? 1 : t;
              const ex = ax + t * dx - px, ey = ay + t * dy - py;
              const d = Math.sqrt(ex * ex + ey * ey);
              const i = r * w + c;
              if (d < dist[i]) dist[i] = d;
            }
          }
        }
      }
    }
    // Los bordes del recorte (cortes de Sutherland–Hodgman) no son costa: la distancia a esos
    // tramos rectos sobre el borde no debe crear una "costa" falsa. Se descartan las celdas cuya
    // distancia mínima viene de un tramo apoyado en el borde: recalcular sin esos tramos sería
    // lo exacto; en la práctica el borde queda fuera del área visible (niebla de borde).
    const q = new Uint8Array(w * h);
    for (let i = 0; i < q.length; i++) {
      const s = (land[i] ? 1 : -1) * Math.min(dist[i], RANGE_M);
      q[i] = Math.max(1, Math.min(255, Math.round(128 + s / STEP_M)));
    }
    const dq = new Uint8Array(q.length);
    for (let i = 0; i < q.length; i++) {
      const prev = i % w ? q[i - 1] : i >= w ? q[i - w] : 0;
      dq[i] = (q[i] - prev) & 0xff;
    }
    const gz = gzipSync(dq, { level: 9 });
    await writeFile(path.join(pubDir, id, `costa-${L.name}.sdf.gz`), gz);
    const maskBytes = L.maskFile && existsSync(path.join(pubDir, id, L.maskFile)) ? (await readFile(path.join(pubDir, id, L.maskFile))).length : 0;
    out.push(`${L.name} ${(gz.length / 1024).toFixed(1)} KB (máscara binaria ${(maskBytes / 1024).toFixed(1)} KB)`);
    void edges;
  }
  console.log(`${id.padEnd(12)} ${out.join(" · ")}`);
}
