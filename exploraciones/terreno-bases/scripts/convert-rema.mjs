#!/usr/bin/env node
/**
 * Convierte un recorte REMA (GeoTIFF, EPSG:3031) en un paquete liviano para el visor.
 * Se corre FUERA del navegador (CLAUDE.md §8).
 *
 * Uso:
 *   npm run convert -- --id <base>          (p. ej. carlini, esperanza; ver public/map/antartida.json)
 *   npm run convert -- --all                (todas las bases con recorte en data/rema)
 *   opcionales: --tif <ruta> --coast <ruta> --sizes 512,1024
 *
 * Salida en public/terrain/<base>/:
 *   terrain-<n>.bin   alturas cuantizadas a uint16 (0 = sin dato; 1..65535 = minM..maxM),
 *                     codificadas "delta-planar-v1": diferencia con el vecino izquierdo
 *                     (o el de arriba en la columna 0), módulo 2^16, guardando primero
 *                     todos los bytes altos y después todos los bajos. Comprime ~40 % mejor.
 *   terrain-<n>.mask  uint8 por vértice: 1 = tierra/hielo según costa ADD, 0 = mar
 *   terrain.json      dimensiones, escala, rango, referencia vertical, base y procedencia
 * Además actualiza public/terrain/index.json con las bases disponibles.
 *
 * No inventa alturas: los píxeles sin dato quedan marcados y el visor no los dibuja.
 */
import { fromFile } from "geotiff";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, rmSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rasterizeLand, downsampleMask } from "./coastline.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const terrainRoot = path.join(root, "public", "terrain");
const dataDir = path.resolve(root, "..", "..", "data");
const remaDir = path.join(dataDir, "rema");

const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const sizes = (opt("sizes") ?? "512,1024").split(",").map(Number);
const mapData = JSON.parse(await readFile(path.join(root, "public", "map", "antartida.json"), "utf8"));

// Carlini usa los archivos originales de P1 (caleta Potter).
const LEGACY = {
  carlini: { tif: "potter-cove_2m.tif", coast: path.join("costa", "add-v7.12-potter-cove.json") },
};
const tifFor = (id) => path.join(remaDir, LEGACY[id]?.tif ?? `${id}_2m.tif`);
const coastFor = (id) => path.join(dataDir, LEGACY[id]?.coast ?? path.join("costa", `${id}.json`));

let ids;
if (args.includes("--all")) {
  ids = mapData.bases.map((b) => b.id).filter((id) => existsSync(tifFor(id)));
} else {
  const id = opt("id");
  if (!id) fail("Falta --id <base> o --all.");
  ids = [id];
}

for (const id of ids) await convertBase(id);
await writeIndex();

async function convertBase(baseId) {
const base = mapData.bases.find((b) => b.id === baseId);
if (!base) fail(`No existe la base "${baseId}" en public/map/antartida.json`);
const input = ids.length === 1 && opt("tif") ? opt("tif") : tifFor(baseId);
const coastPath = ids.length === 1 && opt("coast") ? opt("coast") : coastFor(baseId);
if (!existsSync(input)) fail(`No hay recorte REMA para ${baseId}: ${input}`);
const outDir = path.join(terrainRoot, baseId);
// Borra salidas anteriores (p. ej. formatos viejos sin comprimir).
if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.startsWith("terrain-")) rmSync(path.join(outDir, f));

console.log(`\n── ${base.nombre} ──\nLeyendo ${input}`);
const tiff = await fromFile(input);
const image = await tiff.getImage();
const W = image.getWidth();
const H = image.getHeight();
const [resX, resY] = image.getResolution(); // resY suele ser negativo (norte arriba)
const [originX, originY] = image.getOrigin();
const nodataRaw = image.getGDALNoData();
const geoKeys = image.getGeoKeys() ?? {};
const epsg = geoKeys.ProjectedCSTypeGeoKey ?? geoKeys.GeographicTypeGeoKey ?? null;

if (epsg !== 3031) {
  console.warn(`⚠ CRS EPSG:${epsg ?? "desconocido"} (se esperaba 3031). Revisar antes de usar.`);
}

const [band] = await image.readRasters({ samples: [0] });
const isNoData = (v) =>
  !Number.isFinite(v) || (nodataRaw !== null && v === nodataRaw) || v < -1000 || v > 9000;

let minM = Infinity;
let maxM = -Infinity;
let nodataCount = 0;
for (let i = 0; i < band.length; i++) {
  const v = band[i];
  if (isNoData(v)) {
    nodataCount++;
    continue;
  }
  if (v < minM) minM = v;
  if (v > maxM) maxM = v;
}
if (!Number.isFinite(minM)) fail("El raster no tiene ningún valor válido.");

console.log(
  `${W}×${H} px · ${Math.abs(resX)} m/px · alturas ${minM.toFixed(1)}–${maxM.toFixed(1)} m · sin dato ${(
    (100 * nodataCount) / band.length
  ).toFixed(2)} %`
);

// ─── Costa (SCAR ADD) → máscara tierra/mar a resolución completa ───
const coast = existsSync(coastPath) ? await loadCoastline(coastPath) : null;
let landMask = null;
let coastStats = null;
if (coast && coast.features.length === 0) console.warn("⚠ La costa ADD no tiene polígonos en el recuadro: todo se trata como mar.");
if (coast) {
  landMask = rasterizeLand(coast.features, { width: W, height: H, originX, originY, resX, resY });
  coastStats = compareWithHeights(landMask, band, isNoData);
  const s = coastStats.sea;
  console.log(
    `Costa ${coast.label}: ${(100 * coastStats.landFraction).toFixed(1)} % tierra · ` +
      (s
        ? `mar REMA mediana ${s.p50.toFixed(1)} m (p5 ${s.p5.toFixed(1)}, p95 ${s.p95.toFixed(1)}) · ${(
            100 * coastStats.seaAboveSeaMedianPlus5
          ).toFixed(2)} % del "mar" está >5 m sobre la mediana del mar`
        : "sin mar en el recuadro (base tierra adentro)")
  );
} else {
  console.warn("⚠ Sin costa: el visor no podrá distinguir mar y tierra.");
}

await mkdir(outDir, { recursive: true });
const levels = [];

for (const target of sizes) {
  // Factor entero de reducción para que el lado mayor quede <= target vértices.
  const factor = Math.max(1, Math.ceil(Math.max(W, H) / target));
  const w = Math.floor(W / factor);
  const h = Math.floor(H / factor);
  const out = new Uint16Array(w * h);
  const span = maxM - minM || 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Promedio por bloque de los píxeles válidos; si ninguno es válido → sin dato.
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * W;
        for (let dx = 0; dx < factor; dx++) {
          const v = band[row + x * factor + dx];
          if (!isNoData(v)) {
            sum += v;
            n++;
          }
        }
      }
      out[y * w + x] = n === 0 ? 0 : 1 + Math.round(((sum / n - minM) / span) * 65534);
    }
  }

  // Se guardan ya comprimidos con gzip: no depende de que el hosting comprima
  // archivos binarios (muchos solo comprimen texto). El visor los descomprime
  // con DecompressionStream dentro de un Web Worker.
  const file = `terrain-${target}.bin.gz`;
  const binGz = gzipSync(encodeDeltaPlanar(out, w), { level: 9 });
  await writeFile(path.join(outDir, file), binGz);
  let maskFile = null;
  let maskBytes = 0;
  if (landMask) {
    maskFile = `terrain-${target}.mask.gz`;
    const maskGz = gzipSync(downsampleMask(landMask, W, factor, w, h), { level: 9 });
    maskBytes = maskGz.length;
    await writeFile(path.join(outDir, maskFile), maskGz);
  }
  levels.push({
    file,
    encoding: "delta-planar-v1",
    compression: "gzip",
    maskFile,
    width: w,
    height: h,
    cellSizeM: Math.abs(resX) * factor,
    bytes: out.byteLength,
    transferBytes: binGz.length + maskBytes,
  });
  console.log(
    `→ ${file}: ${w}×${h} vértices, ${(Math.abs(resX) * factor).toFixed(1)} m entre vértices · ${((binGz.length + maskBytes) / 1024).toFixed(0)} KB a descargar`
  );
}

// Si el pipeline de P1 dejó un JSON de procedencia junto al .tif, se copia tal cual.
const sidecar = input.replace(/\.tif+$/i, ".json");
const provenance = existsSync(sidecar) ? JSON.parse(await readFile(sidecar, "utf8")) : null;
if (!provenance) console.warn("⚠ No se encontró el JSON de procedencia junto al .tif.");

// Geoide en la base (para mostrar alturas aproximadas sobre el nivel del mar).
const checkFile = path.join(remaDir, `${baseId}_check.json`);
const check = existsSync(checkFile) ? JSON.parse(await readFile(checkFile, "utf8")) : null;
const [bx, by] = toEPSG3031(base.lat, base.lon);

const meta = {
  generatedAt: new Date().toISOString(),
  id: baseId,
  base: {
    id: baseId,
    nombre: base.nombre,
    permanente: base.permanente,
    lat: base.lat,
    lon: base.lon,
    projected: [Math.round(bx * 100) / 100, Math.round(by * 100) / 100],
    fuente: "COMNAP Antarctic Facilities, nov 2024",
  },
  geoid: check?.geoid ?? null,
  heightCheck: check?.altura_en_base ?? null,
  sourceFile: path.basename(input),
  crs: epsg ? `EPSG:${epsg}` : null,
  original: {
    width: W,
    height: H,
    resolutionM: [Math.abs(resX), Math.abs(resY)],
    originProjected: [originX, originY],
    nodataPercent: (100 * nodataCount) / band.length,
  },
  heights: {
    encoding: "uint16: 0 = sin dato; 1..65535 lineal entre minM y maxM",
    minM,
    maxM,
    // REMA reporta alturas sobre el elipsoide WGS84 salvo que la procedencia diga otra cosa.
    verticalReference: shortDatum(provenance?.verticalReference ?? provenance?.vertical_reference),
    verticalReferenceDetail: provenance?.verticalReference ?? provenance?.vertical_reference ?? null,
    seaLevelM: provenance?.seaLevelM ?? null,
  },
  levels,
  coastline: coast
    ? {
        label: coast.label,
        dataset: "SCAR Antarctic Digital Database — High resolution vector polygons of the Antarctic coastline",
        layer: coast.layer,
        serviceUrl: coast.serviceUrl,
        citation: "SCAR Antarctic Digital Database, 2025, https://doi.org/qc9x",
        licence: "CC BY 4.0 según fichas del ADD de versiones previas; confirmar para v7.12",
        file: coast.file,
        surfaces: [...new Set(coast.features.map((f) => f.attributes.surface))],
        maskEncoding: "uint8 por vértice: 1 = dentro de un polígono ADD (tierra/hielo), 0 = mar",
        comparisonWithRema: coastStats,
      }
    : null,
  provenance,
};

await writeFile(path.join(outDir, "terrain.json"), JSON.stringify(meta, null, 2));
console.log(`Listo: ${path.relative(root, outDir)}/terrain.json`);
}

/** Índice de terrenos disponibles, para el mapa. */
async function writeIndex() {
  const out = [];
  for (const b of mapData.bases) {
    const f = path.join(terrainRoot, b.id, "terrain.json");
    if (!existsSync(f)) continue;
    const m = JSON.parse(await readFile(f, "utf8"));
    out.push({
      id: b.id,
      nodataPercent: Math.round(m.original.nodataPercent * 100) / 100,
      seaPercent: m.coastline?.comparisonWithRema ? Math.round((1 - m.coastline.comparisonWithRema.landFraction) * 1000) / 10 : null,
      levels: m.levels.map((l) => ({ size: l.width, cellSizeM: l.cellSizeM })),
    });
  }
  await writeFile(path.join(terrainRoot, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), terrains: out }, null, 2));
  console.log(`\nÍndice: ${out.length} terrenos en public/terrain/index.json`);
}

/** delta-planar-v1: ver encabezado. */
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

/** EPSG:3031 (mismas fórmulas que scripts/build-map.mjs, verificadas contra proj4). */
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

async function loadCoastline(file) {
  const j = JSON.parse(await readFile(file, "utf8"));
  if (j.spatialReference && j.spatialReference.wkid !== 3031) fail(`La costa no está en EPSG:3031 (${j.spatialReference.wkid}).`);
  const metaFile = file.replace(/\.json$/, ".meta.json");
  const m = existsSync(metaFile) ? JSON.parse(await readFile(metaFile, "utf8")) : {};
  return {
    file: path.basename(file),
    features: j.features,
    layer: m.layer ?? null,
    serviceUrl: m.serviceUrl ?? null,
    label: m.label ?? "SCAR ADD",
  };
}

/** Contrasta la costa ADD con las alturas REMA: el "mar" debería ser plano y bajo. */
function compareWithHeights(mask, heights, isNoData) {
  const sea = [];
  const land = [];
  for (let i = 0; i < heights.length; i += 4) {
    // muestreo 1 de cada 4 píxeles: suficiente para estadísticas
    const v = heights[i];
    if (isNoData(v)) continue;
    (mask[i] ? land : sea).push(v);
  }
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  sea.sort((a, b) => a - b);
  land.sort((a, b) => a - b);
  const seaMedian = sea.length ? pct(sea, 0.5) : NaN;
  const stats = (arr) =>
    arr.length ? { n: arr.length, p5: pct(arr, 0.05), p50: pct(arr, 0.5), p95: pct(arr, 0.95) } : null;
  return {
    landFraction: land.length / (land.length + sea.length),
    sea: stats(sea),
    land: stats(land),
    seaAboveSeaMedianPlus5: sea.length ? sea.filter((v) => v > seaMedian + 5).length / sea.length : 0,
    landWithin1mOfSeaMedian: land.length ? land.filter((v) => v < seaMedian + 1).length / land.length : 0,
    note: "Muestra 1 de cada 4 píxeles. 'Mar' con alturas altas sugiere hielo/tierra en REMA donde el ADD marca mar (p. ej., un frente glaciar en otra posición).",
  };
}

function shortDatum(vr) {
  if (!vr) return "referencia vertical sin confirmar";
  const text = typeof vr === "string" ? vr : vr.datum ?? JSON.stringify(vr);
  return /elipsoide|ellipsoid/i.test(text) ? "sobre elipsoide WGS84, no sobre el nivel del mar" : text;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
