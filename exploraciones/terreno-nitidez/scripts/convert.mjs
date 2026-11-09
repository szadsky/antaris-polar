#!/usr/bin/env node
/**
 * Convierte los recortes REMA 2 m (data/rema) al formato de esta exploración.
 *
 * Idea: guardar las alturas con una precisión acorde al dato (paso de 0,5 m en
 * vez de 1,7 cm) libera bytes que se usan en el DOBLE de resolución (4 m en vez
 * de 8 m), con un peso de descarga similar al de exploraciones/terreno-bases.
 *
 * Por base, en public/terreno/<base>/:
 *   relieve-4m.bin.gz   alturas 4 m (computadoras)  · uint16 delta-planar-v1, gzip
 *   relieve-8m.bin.gz   alturas 8 m (celulares)
 *   mar-4m.mask.gz      uint8 por muestra: 1 = tierra/hielo (costa SCAR ADD), 0 = mar
 *   mar-8m.mask.gz
 *   terreno.json        dimensiones, paso, base, geoide, fuentes
 * y public/terreno/index.json con las bases disponibles.
 *
 * Codificación de alturas: 0 = sin dato; q ≥ 1 → h = minM + (q − 1) · stepM (m elipsoidales).
 *
 * Uso: npm run convert [-- --step 0.5] [-- --only carlini,esperanza]
 */
import { fromFile } from "geotiff";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rasterizeLand, downsampleMask } from "./coastline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outRoot = path.join(root, "public", "terreno");
const dataDir = path.resolve(root, "..", "..", "data");

const args = process.argv.slice(2);
const opt = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
const STEP_M = Number(opt("step") ?? 0.5);
const only = opt("only")?.split(",") ?? null;
const LEVELS = [
  { name: "4m", factor: 2 }, // 2 m × 2
  { name: "8m", factor: 4 },
];

const bases = await loadBases();
const done = [];
for (const b of bases) {
  if (only && !only.includes(b.id)) continue;
  const tif = path.join(dataDir, "rema", b.id === "carlini" ? "potter-cove_2m.tif" : `${b.id}_2m.tif`);
  if (!existsSync(tif)) {
    console.warn(`⚠ ${b.id}: no hay recorte REMA (${path.basename(tif)}); se omite.`);
    continue;
  }
  done.push(await convert(b, tif));
}

// Índice (incluye bases convertidas antes si no se pidieron ahora)
const index = [];
for (const b of bases) {
  const f = path.join(outRoot, b.id, "terreno.json");
  if (existsSync(f)) {
    const m = JSON.parse(await readFile(f, "utf8"));
    index.push({ id: b.id, nombre: b.nombre, permanente: b.permanente, kb: m.levels.map((l) => Math.round(l.transferBytes / 1024)) });
  }
}
await writeFile(path.join(outRoot, "index.json"), JSON.stringify({ generado: new Date().toISOString(), stepM: STEP_M, bases: index }, null, 2));
console.log(`\nÍndice: ${index.length} bases · paso ${STEP_M} m`);

async function convert(base, tifPath) {
  const img = await (await fromFile(tifPath)).getImage();
  const W = img.getWidth();
  const H = img.getHeight();
  const [resX, resY] = img.getResolution();
  const [originX, originY] = img.getOrigin();
  const nodata = img.getGDALNoData();
  const [band] = await img.readRasters({ samples: [0] });
  const bad = (v) => !Number.isFinite(v) || v === nodata || v < -1000 || v > 9000;
  let minM = Infinity;
  let maxM = -Infinity;
  for (const v of band) if (!bad(v)) (minM = Math.min(minM, v)), (maxM = Math.max(maxM, v));
  if ((maxM - minM) / STEP_M + 1 > 65535) throw new Error(`${base.id}: rango demasiado grande para paso ${STEP_M} m`);

  const coastFile = path.join(dataDir, "costa", base.id === "carlini" ? "add-v7.12-potter-cove.json" : `${base.id}.json`);
  const coast = existsSync(coastFile) ? JSON.parse(await readFile(coastFile, "utf8")) : null;
  const land = coast ? rasterizeLand(coast.features, { width: W, height: H, originX, originY, resX, resY }) : null;

  const outDir = path.join(outRoot, base.id);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const levels = [];
  for (const L of LEVELS) {
    const f = L.factor;
    const w = Math.floor(W / f);
    const h = Math.floor(H / f);
    const q = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dy = 0; dy < f; dy++) {
          const row = (y * f + dy) * W + x * f;
          for (let dx = 0; dx < f; dx++) {
            const v = band[row + dx];
            if (!bad(v)) (s += v), n++;
          }
        }
        q[y * w + x] = n === 0 ? 0 : 1 + Math.round((s / n - minM) / STEP_M);
      }
    }
    const bin = gzipSync(encodeDeltaPlanar(q, w), { level: 9 });
    const file = `relieve-${L.name}.bin.gz`;
    await writeFile(path.join(outDir, file), bin);
    let maskFile = null;
    let maskBytes = 0;
    if (land) {
      const m = gzipSync(downsampleMask(land, W, f, w, h), { level: 9 });
      maskFile = `mar-${L.name}.mask.gz`;
      maskBytes = m.length;
      await writeFile(path.join(outDir, maskFile), m);
    }
    levels.push({ name: L.name, file, maskFile, width: w, height: h, cellSizeM: Math.abs(resX) * f, transferBytes: bin.length + maskBytes });
  }

  const check = JSON.parse(await readFile(path.join(dataDir, "rema", `${base.id}_check.json`), "utf8").catch(() => "null"));
  const prov = JSON.parse(await readFile(tifPath.replace(/\.tif$/, ".json"), "utf8").catch(() => "null"));
  const meta = {
    id: base.id,
    base: { ...base },
    geoid: check?.geoid ?? null,
    origin: [originX, originY],
    original: { width: W, height: H, resolutionM: Math.abs(resX) },
    heights: { minM, maxM, stepM: STEP_M, encoding: "uint16 delta-planar-v1 + gzip; 0 = sin dato; h = minM + (q−1)·stepM", reference: "elipsoide WGS84" },
    levels,
    fuentes: {
      relieve: prov ? `${prov.dataset} v${prov.version} (${prov.product})` : "REMA Mosaics v2.0",
      relieveCita: prov?.citation?.dataset ?? null,
      costa: coast ? "SCAR Antarctic Digital Database v7.12 (2025), polígonos alta resolución" : null,
      base: "COMNAP Antarctic Facilities, nov 2024",
    },
  };
  await writeFile(path.join(outDir, "terreno.json"), JSON.stringify(meta, null, 2));
  console.log(`${base.id.padEnd(12)} ${levels.map((l) => `${l.name} ${(l.transferBytes / 1024).toFixed(0)} KB`).join(" · ")}`);
  return meta;
}

/** Igual que exploraciones/terreno-bases: delta con el vecino izquierdo (o de arriba), bytes altos y bajos separados. */
function encodeDeltaPlanar(values, w) {
  const n = values.length;
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const prev = i % w ? values[i - 1] : i >= w ? values[i - w] : 0;
    const d = (values[i] - prev) & 0xffff;
    buf[i] = d >> 8;
    buf[n + i] = d & 0xff;
  }
  return buf;
}

/** Bases argentinas desde el CSV de COMNAP (data/bases), proyectadas a EPSG:3031. */
async function loadBases() {
  const csv = new TextDecoder("latin1").decode(await readFile(path.join(dataDir, "bases", "COMNAP_Facilities_Nov2024.csv")));
  const rows = parseCsv(csv);
  const head = rows.shift();
  const c = (name) => head.indexOf(name);
  return rows
    .filter((r) => r[c("Operator (primary)")] === "Argentina")
    .map((r) => {
      const nombre = r[c("Official Name")];
      const lat = Number(r[c("Latitude (DD)")]);
      const lon = Number(r[c("Longitude (DD)")]);
      return {
        id: slug(nombre.replace(/^Base (Antártica )?/, "")),
        nombre,
        permanente: r[c("Seasonality")] === "Year-Round",
        lat,
        lon,
        projected: toEPSG3031(lat, lon).map((v) => Math.round(v * 100) / 100),
      };
    })
    .sort((a, b) => Number(b.permanente) - Number(a.permanente) || a.nombre.localeCompare(b.nombre, "es"));
}

/** EPSG:3031 (WGS84, lat_ts −71°). Contrastada con proj4 en exploraciones/terreno-bases: < 6 m. */
function toEPSG3031(latDeg, lonDeg) {
  const A = 6378137;
  const E = 0.0818191908426215;
  const t = (phi) => Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2);
  const phiC = (71 * Math.PI) / 180;
  const mc = Math.cos(phiC) / Math.sqrt(1 - E * E * Math.sin(phiC) ** 2);
  const rho = (A * mc * t((-latDeg * Math.PI) / 180)) / t(phiC);
  const lam = (lonDeg * Math.PI) / 180;
  return [rho * Math.sin(lam), rho * Math.cos(lam)];
}

function parseCsv(text) {
  const out = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x !== "")) out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) row.push(field), out.push(row);
  return out;
}

function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
