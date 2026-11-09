#!/usr/bin/env node
/**
 * Prepara los datos del mapa de bases argentinas (se corre fuera del navegador).
 *
 *  - Bases: CSV oficial de COMNAP (Facilities, nov 2024) → filtra operador Argentina.
 *  - Costa: SCAR ADD v7.12, polígonos de resolución media, simplificados en el
 *    servidor (maxAllowableOffset) y convertidos a trazados SVG en kilómetros.
 *
 * Salida: public/map/antartida.json (pensado para pesar poco: ~decenas de KB con brotli).
 *
 * Uso: npm run build:map [-- --refresh]   (--refresh vuelve a consultar el ADD)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = path.resolve(root, "..", "..", "data");
const outDir = path.join(root, "public", "map");
const refresh = process.argv.includes("--refresh");

const ADD_MEDIUM =
  "https://services7.arcgis.com/tPxy1hrFDhJfZ0Mf/arcgis/rest/services/Medium_resolution_vector_polygons_of_the_Antarctic_coastline/FeatureServer/1";
const SIMPLIFY_M = 1500; // tolerancia de simplificación en el servidor
const MIN_AREA_M2 = 1e6; // descarta islotes < 1 km² (las bases están en islas mayores)

// ─── Proyección estereográfica polar sur (EPSG:3031, WGS84, lat_ts = -71°) ───
const A = 6378137;
const E = 0.0818191908426215;
function tFn(phi) {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * s) / (1 + E * s), E / 2);
}
const PHI_C = (71 * Math.PI) / 180;
const MC = Math.cos(PHI_C) / Math.sqrt(1 - E * E * Math.sin(PHI_C) ** 2);
const TC = tFn(PHI_C);
export function toEPSG3031(latDeg, lonDeg) {
  // Fórmulas del aspecto norte con φ y λ invertidos (Snyder 1987, cap. 21).
  const rho = (A * MC * tFn((-latDeg * Math.PI) / 180)) / TC;
  const lam = (lonDeg * Math.PI) / 180;
  return [rho * Math.sin(lam), rho * Math.cos(lam)];
}

// ─── Bases COMNAP ───
const csvPath = path.join(dataDir, "bases", "COMNAP_Facilities_Nov2024.csv");
const csv = new TextDecoder("latin1").decode(await readFile(csvPath));
const rows = parseCsv(csv);
const header = rows.shift();
const col = (name) => header.indexOf(name);
const bases = rows
  .filter((r) => r[col("Operator (primary)")] === "Argentina" || r[col("Operator (additional)")] === "Argentina")
  .map((r) => {
    const lat = Number(r[col("Latitude (DD)")]);
    const lon = Number(r[col("Longitude (DD)")]);
    const [x, y] = toEPSG3031(lat, lon);
    const name = r[col("Official Name")];
    return {
      id: slug(name.replace(/^Base (Antártica )?/, "")),
      nombre: name,
      anio: Number(r[col("Year Established")]) || null,
      permanente: r[col("Seasonality")] === "Year-Round",
      estado: r[col("Status")], // "Open" | "Temporarily Closed"
      tipo: r[col("Type")],
      lat,
      lon,
      latDDM: r[col("Latitude (DDM)")],
      lonDDM: r[col("Longitude (DDM)")],
      elevacionM: Number(r[col("Elevation (meters)")]) || null,
      elevacionDatum: r[col("Elevation Datum")] || null,
      poblacionPico: Number(r[col("Peak Population")]) || null,
      operadorAdicional: r[col("Operator (additional)")] || null,
      // km en EPSG:3031 (el mapa trabaja en km)
      xKm: round(x / 1000, 2),
      yKm: round(y / 1000, 2),
    };
  })
  .sort((a, b) => Number(b.permanente) - Number(a.permanente) || a.nombre.localeCompare(b.nombre, "es"));
console.log(`Bases argentinas: ${bases.length} (${bases.filter((b) => b.permanente).length} permanentes)`);

// ─── Costa ADD ───
const coastCache = path.join(dataDir, "costa", "add-v7.12-medium-continent.json");
let features;
if (!refresh && existsSync(coastCache)) {
  features = JSON.parse(await readFile(coastCache, "utf8")).features;
} else {
  features = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      where: `Shape__Area >= ${MIN_AREA_M2}`,
      outFields: "surface,Shape__Area",
      outSR: "3031",
      maxAllowableOffset: String(SIMPLIFY_M),
      geometryPrecision: "0",
      resultOffset: String(offset),
      resultRecordCount: "1000",
      orderByFields: "FID",
      f: "json",
    });
    const res = await fetch(`${ADD_MEDIUM}/query?${params}`);
    const j = await res.json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    features.push(...j.features);
    if (!j.exceededTransferLimit) break;
  }
  await writeFile(coastCache, JSON.stringify({ retrievedAt: new Date().toISOString(), source: ADD_MEDIUM, simplifyM: SIMPLIFY_M, minAreaM2: MIN_AREA_M2, features }));
}
console.log(`Polígonos de costa: ${features.length}`);

// Trazados SVG en km enteros (la costa ya viene simplificada a 1,5 km).
const paths = compactPaths(features, 1000);

// ─── Detalle de la Península (se descarga solo al acercarse) ───
// 11 de las 13 bases están ahí. Resolución media simplificada a 400 m, en unidades de 100 m.
const PEN_PAD_M = 250000;
const pen = bases.filter((b) => b.id !== "belgrano-ii" && b.id !== "orcadas");
const penEnv = {
  xmin: Math.min(...pen.map((b) => b.xKm * 1000)) - PEN_PAD_M,
  ymin: Math.min(...pen.map((b) => b.yKm * 1000)) - PEN_PAD_M,
  xmax: Math.max(...pen.map((b) => b.xKm * 1000)) + PEN_PAD_M,
  ymax: Math.max(...pen.map((b) => b.yKm * 1000)) + PEN_PAD_M,
  spatialReference: { wkid: 3031 },
};
const penCache = path.join(dataDir, "costa", "add-v7.12-medium-peninsula.json");
let penFeatures;
if (!refresh && existsSync(penCache)) {
  penFeatures = JSON.parse(await readFile(penCache, "utf8")).features;
} else {
  penFeatures = await queryAll(ADD_MEDIUM, {
    geometry: JSON.stringify(penEnv),
    geometryType: "esriGeometryEnvelope",
    inSR: "3031",
    spatialRel: "esriSpatialRelIntersects",
    where: "Shape__Area >= 100000",
    outFields: "surface",
    outSR: "3031",
    maxAllowableOffset: "400",
    geometryPrecision: "0",
  });
  await writeFile(penCache, JSON.stringify({ retrievedAt: new Date().toISOString(), source: ADD_MEDIUM, envelope: penEnv, simplifyM: 400, features: penFeatures }));
}
const peninsula = {
  unidadM: 100,
  // recuadro en km (sistema SVG, y invertida) donde este detalle reemplaza al general
  recuadroKm: {
    x: penEnv.xmin / 1000,
    y: -penEnv.ymax / 1000,
    w: (penEnv.xmax - penEnv.xmin) / 1000,
    h: (penEnv.ymax - penEnv.ymin) / 1000,
  },
  costa: compactPaths(penFeatures, 100),
};
const penJson = JSON.stringify(peninsula);
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "peninsula.json"), penJson);

const out = {
  generado: new Date().toISOString(),
  unidades: "km en EPSG:3031 (estereográfica polar sur); en SVG y está invertida",
  bases,
  costa: paths,
  fuentes: {
    bases: {
      dataset: "COMNAP Antarctic Facilities (noviembre 2024)",
      url: "https://www.comnap.aq/antarctic-facilities-information",
      archivo: "https://www.comnap.aq/s/Facilities_Nov2024.csv",
      uso: "Uso libre solo con fines educativos y no comerciales; citar COMNAP 2024. La información la aporta cada Programa Antártico Nacional.",
      cita: "COMNAP 2024",
    },
    costa: {
      dataset: "SCAR Antarctic Digital Database v7.12 — Medium resolution vector polygons of the Antarctic coastline",
      url: ADD_MEDIUM,
      simplificacionM: SIMPLIFY_M,
      areaMinimaKm2: MIN_AREA_M2 / 1e6,
      licencia: "CC BY 4.0 (según fichas del ADD de versiones previas; confirmar para v7.12)",
      cita: "SCAR Antarctic Digital Database, 2025, https://doi.org/qc9x",
    },
  },
};

const json = JSON.stringify(out);
await writeFile(path.join(outDir, "antartida.json"), json);
const zlib = await import("node:zlib");
const kb = (s) => `${(s.length / 1024).toFixed(0)} KB (brotli ${(zlib.brotliCompressSync(Buffer.from(s)).length / 1024).toFixed(0)} KB)`;
console.log(`→ public/map/antartida.json ${kb(json)}`);
console.log(`→ public/map/peninsula.json ${kb(penJson)} · ${penFeatures.length} polígonos`);

// ─── utilidades ───

/** Polígonos ADD → trazados SVG compactos (coordenadas enteras en `unit` metros, comandos relativos). */
function compactPaths(feats, unit) {
  const out = {};
  for (const f of feats) {
    const key = f.attributes.surface === "land" ? "tierra" : "hielo"; // land | ice shelf | ice tongue | rumple
    let d = "";
    for (const ring of f.geometry.rings) {
      const pts = [];
      for (const [x, y] of ring) {
        const p = [Math.round(x / unit), Math.round(-y / unit)]; // y = -y: "arriba" de la grilla arriba en SVG
        const last = pts[pts.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
      }
      if (pts.length < 3) continue; // anillo degenerado a esta escala
      let rel = "";
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        rel += (dx < 0 || !rel ? "" : " ") + dx + (dy < 0 ? "" : " ") + dy;
      }
      d += `M${pts[0][0]} ${pts[0][1]}l${rel}z`;
    }
    out[key] = (out[key] ?? "") + d;
  }
  return out;
}

async function queryAll(url, params) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({ ...params, resultOffset: String(offset), resultRecordCount: "1000", orderByFields: "FID", f: "json" });
    const j = await (await fetch(`${url}/query?${q}`)).json();
    if (j.error) throw new Error(JSON.stringify(j.error));
    all.push(...j.features);
    if (!j.exceededTransferLimit) return all;
  }
}

function parseCsv(text) {
  const out = [];
  let row = [];
  let field = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

function slug(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function round(n, d) {
  const k = 10 ** d;
  return Math.round(n * k) / k;
}
