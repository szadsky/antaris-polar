#!/usr/bin/env node
// Recorte reproducible de REMA Mosaics v2.0 (PGC) para caleta Potter, isla 25 de Mayo.
// Lee SOLO la ventana del AOI desde los COG públicos de AWS (HTTP range requests), sin credenciales.
//
// Uso:
//   node fetch-potter-cove.mjs                      # resolución automática (la más fina <= 150 MB)
//   node fetch-potter-cove.mjs --res 10             # forzar resolución (2 | 10 | 32)
//   node fetch-potter-cove.mjs --bbox xmin,ymin,xmax,ymax --name prueba --out ../../data/rema
//   node fetch-potter-cove.mjs --dry-run            # solo calcula tamaños y teselas

import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { STAC, EPSG3031, AOI_3031, MAX_BYTES, RESOLUTIONS, REFERENCE_POINTS, RETRIEVAL_DATE } from './config.mjs';
import { writeFloat32GeoTiff, writeUint8GeoTiff } from './lib/tiff-writer.mjs';
import { encodeGrayPng } from './lib/png.mjs';
import { fromArrayBuffer } from 'geotiff';

const here = dirname(fileURLToPath(import.meta.url));
proj4.defs('EPSG:3031', EPSG3031);
const toLL = proj4('EPSG:3031', 'EPSG:4326');
const to3031 = proj4('EPSG:4326', 'EPSG:3031');

// ---------- argumentos ----------
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const outDir = resolve(here, args.out ?? '../../data/rema');
const baseName = args.name ?? 'potter-cove';
const bbox = args.bbox ? args.bbox.split(',').map(Number) : AOI_3031;
const dryRun = !!args['dry-run'];
// Generalización para otras bases (sin argumentos se conserva el comportamiento de caleta Potter):
//   --label "<lugar>"         texto descriptivo del recorte
//   --refs <archivo.json>     puntos de referencia [{key,name,lon,lat,source}]
//   --sea-band "min,max"      franja (m elipsoidales) donde buscar el mar aplanado; depende del geoide local
const placeLabel = args.label ?? 'Potter Cove (King George Island)';
const refPoints = args.refs ? JSON.parse(readFileSync(resolve(args.refs), 'utf8')) : REFERENCE_POINTS;
const [SEA_LO, SEA_HI] = args['sea-band'] ? args['sea-band'].split(',').map(Number) : [20, 24];
const isPotter = !args.label;

// ---------- contador de bytes transferidos ----------
let bytesFetched = 0;
let requests = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => {
  const r = await realFetch(...a);
  requests++;
  const len = Number(r.headers.get('content-length') || 0);
  bytesFetched += len;
  return r;
};

async function withRetry(fn, label, tries = 4) {
  for (let a = 1; ; a++) {
    try {
      return await fn();
    } catch (e) {
      if (a >= tries) throw new Error(`${label}: ${e.message} (tras ${a} intentos)`);
      console.log(`  reintento ${a} (${label}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * a));
    }
  }
}

async function getJson(url) {
  const r = await realFetch(url);
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

// ---------- esquema de teselas REMA v2 ----------
// Verificado contra proj:bbox de los ítems STAC: supertesela row_col de 100 km con
// x_min = -3 000 000 + (col-1)*100 000 ; y_min = -3 000 000 + (row-1)*100 000.
// A 2 m cada supertesela se divide en 4 subteselas de 50 km: _<fila 1=sur|2=norte>_<col 1=oeste|2=este>.
const pad = (n) => String(n).padStart(2, '0');
function candidateItemIds(res, [xmin, ymin, xmax, ymax]) {
  const ids = new Set();
  const step = res === 2 ? 50000 : 100000;
  for (let x = Math.floor(xmin / step) * step; x < xmax; x += step) {
    for (let y = Math.floor(ymin / step) * step; y < ymax; y += step) {
      const col = Math.floor((x + 3e6) / 1e5) + 1;
      const row = Math.floor((y + 3e6) / 1e5) + 1;
      const tile = `${pad(row)}_${pad(col)}`;
      if (res === 2) {
        const sr = y - (-3e6 + (row - 1) * 1e5) >= 50000 ? 2 : 1;
        const sc = x - (-3e6 + (col - 1) * 1e5) >= 50000 ? 2 : 1;
        ids.add(`${tile}/${tile}_${sr}_${sc}_2m_v2.0`);
      } else ids.add(`${tile}/${tile}_${res}m_v2.0`);
    }
  }
  return [...ids];
}

function llEnvelope([xmin, ymin, xmax, ymax]) {
  const pts = [];
  const n = 50;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([xmin + t * (xmax - xmin), ymin], [xmin + t * (xmax - xmin), ymax], [xmin, ymin + t * (ymax - ymin)], [xmax, ymin + t * (ymax - ymin)]);
  }
  const ll = pts.map((p) => toLL.forward(p));
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return {
    west: r(Math.min(...ll.map((p) => p[0]))),
    south: r(Math.min(...ll.map((p) => p[1]))),
    east: r(Math.max(...ll.map((p) => p[0]))),
    north: r(Math.max(...ll.map((p) => p[1]))),
    corners: {
      upper_left: toLL.forward([xmin, ymax]).map(r),
      upper_right: toLL.forward([xmax, ymax]).map(r),
      lower_right: toLL.forward([xmax, ymin]).map(r),
      lower_left: toLL.forward([xmin, ymin]).map(r),
    },
  };
}

// ---------- principal ----------
async function main() {
  // 1) Resolución: la más fina cuyo recorte float32 entre en MAX_BYTES
  const sizes = RESOLUTIONS.map((res) => {
    const w = Math.ceil((bbox[2] - bbox[0]) / res);
    const h = Math.ceil((bbox[3] - bbox[1]) / res);
    return { res, width: w, height: h, bytes: w * h * 4 };
  });
  console.log('Tamaños estimados (float32 sin comprimir):');
  for (const s of sizes) console.log(`  ${s.res} m: ${s.width} x ${s.height} px = ${(s.bytes / 2 ** 20).toFixed(1)} MiB`);
  const res = args.res ? Number(args.res) : sizes.find((s) => s.bytes <= MAX_BYTES)?.res;
  if (!res) throw new Error('Ninguna resolución entra en el límite');
  console.log(`Resolución elegida: ${res} m`);

  // 2) Descubrir ítems STAC
  const ids = candidateItemIds(res, bbox);
  const items = [];
  const missing = [];
  for (const id of ids) {
    const url = `${STAC.base}/${res}m/${id}.json`;
    const item = await getJson(url);
    if (!item) {
      missing.push({ id, url });
      console.log(`  SIN ítem STAC (sin cobertura en el catálogo): ${id}`);
      continue;
    }
    item.__url = url;
    items.push(item);
    const p = item.properties;
    console.log(`  ítem ${item.id}  proj:bbox=${JSON.stringify(p['proj:bbox'])}  data_perc=${p['pgc:data_perc']}`);
  }
  if (!items.length) throw new Error('No hay teselas REMA para el AOI — BLOQUEO: no se puede generar el recorte.');

  // 3) Grilla de salida alineada a la grilla de las teselas (sin remuestreo)
  const t0 = items[0].properties['proj:transform'];
  const gx0 = t0[2];
  const gy0 = t0[5];
  const snapDown = (v, o) => o + Math.floor((v - o) / res) * res;
  const snapUp = (v, o) => o + Math.ceil((v - o) / res) * res;
  const ox = snapDown(bbox[0], gx0);
  const oy = snapUp(bbox[3], gy0); // borde norte
  const ex = snapUp(bbox[2], gx0);
  const ey = snapDown(bbox[1], gy0);
  const width = Math.round((ex - ox) / res);
  const height = Math.round((oy - ey) / res);
  const outBbox = [ox, ey, ex, oy];
  console.log(`Grilla de salida: origen (${ox}, ${oy}), ${width} x ${height} px, bbox ${JSON.stringify(outBbox)}`);
  if (dryRun) return;

  const NODATA = -9999;
  const out = new Float32Array(width * height).fill(NODATA);
  const sourceFrom = new Uint8Array(width * height); // índice de ítem + 1
  // Asset "count" de REMA: n.º de tiras DEM que aportan a cada píxel (0 = sin medición).
  const countOut = new Uint8Array(width * height);
  let overlapN = 0;
  let overlapMaxDiff = 0;
  let overlapSumDiff = 0;
  const tilesUsed = [];

  for (const [k, item] of items.entries()) {
    const href = item.assets.dem.href;
    const tiff = await withRetry(() => fromUrl(href, { allowFullFile: false }), href);
    const img = await tiff.getImage();
    const keys = img.getGeoKeys();
    const [rx, ry] = img.getResolution();
    const [tx, ty] = img.getOrigin();
    const nod = img.getGDALNoData();
    const tw = img.getWidth();
    const th = img.getHeight();
    const check = {
      epsg: keys.ProjectedCSTypeGeoKey,
      resolution: [rx, ry],
      origin: [tx, ty],
      nodata: nod,
      size: [tw, th],
      tiled: img.isTiled,
      tileSize: img.isTiled ? [img.getTileWidth(), img.getTileHeight()] : null,
      overviews: (await tiff.getImageCount()) - 1,
      compression: img.fileDirectory.Compression,
    };
    if (check.epsg !== 3031) throw new Error(`${href}: EPSG ${check.epsg} != 3031`);
    if (Math.abs(rx - res) > 1e-9 || Math.abs(ry + res) > 1e-9) throw new Error(`${href}: resolución ${rx},${ry}`);
    const pt = item.properties['proj:transform'];
    if (tx !== pt[2] || ty !== pt[5]) throw new Error(`${href}: origen ${tx},${ty} no coincide con STAC ${pt[2]},${pt[5]}`);

    // ventana en píxeles de la tesela
    const c0 = Math.round((ox - tx) / res);
    const r0 = Math.round((ty - oy) / res);
    const wx0 = Math.max(0, c0);
    const wy0 = Math.max(0, r0);
    const wx1 = Math.min(tw, c0 + width);
    const wy1 = Math.min(th, r0 + height);
    if (wx1 <= wx0 || wy1 <= wy0) {
      console.log(`  ${item.id}: no intersecta el AOI, se omite`);
      continue;
    }
    const before = bytesFetched;
    const [band] = await withRetry(() => img.readRasters({ window: [wx0, wy0, wx1, wy1], samples: [0] }), `dem ${item.id}`);
    const ww = wx1 - wx0;
    let valid = 0;
    for (let j = 0; j < wy1 - wy0; j++) {
      for (let i = 0; i < ww; i++) {
        const v = band[j * ww + i];
        if (v === nod || Number.isNaN(v)) continue;
        valid++;
        const o = (wy0 - r0 + j) * width + (wx0 - c0 + i);
        if (out[o] === NODATA) {
          out[o] = v;
          sourceFrom[o] = k + 1;
        } else {
          const d = Math.abs(out[o] - v);
          overlapN++;
          overlapSumDiff += d;
          if (d > overlapMaxDiff) overlapMaxDiff = d;
        }
      }
    }
    // asset count (uint8) en la misma ventana -> distingue medición fotogramétrica de relleno
    const ctiff = await withRetry(() => fromUrl(item.assets.count.href, { allowFullFile: false }), item.assets.count.href);
    const cimg = await ctiff.getImage();
    const [cox, coy] = cimg.getOrigin();
    if (cox !== tx || coy !== ty || cimg.getWidth() !== tw) throw new Error(`count: grilla distinta a dem en ${item.id}`);
    const [cband] = await withRetry(() => cimg.readRasters({ window: [wx0, wy0, wx1, wy1], samples: [0] }), `count ${item.id}`);
    for (let j = 0; j < wy1 - wy0; j++) {
      for (let i = 0; i < ww; i++) {
        const o = (wy0 - r0 + j) * width + (wx0 - c0 + i);
        if (sourceFrom[o] === k + 1) countOut[o] = cband[j * ww + i];
      }
    }
    const used = {
      item_id: item.id,
      tile: item.properties['pgc:tile'],
      stac_item: item.__url,
      dem_cog: href,
      count_cog: item.assets.count.href,
      window_px: [wx0, wy0, wx1, wy1],
      window_valid_px: valid,
      bytes_fetched_approx: bytesFetched - before,
      item_proj_bbox: item.properties['proj:bbox'],
      item_data_perc: item.properties['pgc:data_perc'],
      item_start_datetime: item.properties.start_datetime,
      item_end_datetime: item.properties.end_datetime,
      item_num_components: item.properties['pgc:num_components'],
      item_published: item.properties.published,
      item_created: item.properties.created,
      cog_check: check,
    };
    tilesUsed.push(used);
    console.log(`  ${item.id}: ventana ${JSON.stringify(used.window_px)}, válidos ${valid}, ~${(used.bytes_fetched_approx / 2 ** 20).toFixed(1)} MiB`);
  }

  // 4) Estadísticas
  let n = 0, nod = 0, min = Infinity, max = -Infinity, sum = 0;
  for (const v of out) {
    if (v === NODATA) { nod++; continue; }
    n++; sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = n ? sum / n : null;
  // píxeles con valor pero sin tiras (count = 0): relleno de superficie del mar u otro relleno de PGC
  let filled = 0, fMin = Infinity, fMax = -Infinity, mN = 0, mMin = Infinity, mMax = -Infinity, mSum = 0;
  const countHist = {};
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v === NODATA) continue;
    const c = countOut[i];
    countHist[c] = (countHist[c] || 0) + 1;
    if (c === 0) { filled++; if (v < fMin) fMin = v; if (v > fMax) fMax = v; }
    else { mN++; mSum += v; if (v < mMin) mMin = v; if (v > mMax) mMax = v; }
  }
  // Heurística de superficie de mar "aplanada": valor en [20, 24] m y rango 3x3 < 0.05 m.
  // (El mosaico reemplaza el océano dentro de la máscara costera por una altura de superficie del mar,
  //  aun cuando count > 0; por eso count no alcanza para separar mar de tierra.)
  let flat = 0, flatC0 = 0;
  const flatMask = new Uint8Array(out.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = out[i];
      if (v === NODATA || v < SEA_LO || v > SEA_HI) continue;
      let lo = v, hi = v, ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
        const u = out[i + dy * width + dx];
        if (u === NODATA) { ok = false; break; }
        if (u < lo) lo = u; if (u > hi) hi = u;
      }
      if (ok && hi - lo < 0.05) { flat++; flatMask[i] = 1; if (countOut[i] === 0) flatC0++; }
    }
  }
  let lN = 0, lMin = Infinity, lMax = -Infinity, lSum = 0;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v === NODATA || flatMask[i] || countOut[i] === 0) continue;
    lN++; lSum += v; if (v < lMin) lMin = v; if (v > lMax) lMax = v;
  }
  console.log(`Superficie de mar aplanada (heurística): ${flat} px (${(100 * flat / out.length).toFixed(2)} %), de ellos con count=0: ${flatC0}`);
  console.log(`Medidos (count>0): ${mN} (${(100 * mN / out.length).toFixed(2)} %), sin medición/relleno (count=0): ${filled} (${(100 * filled / out.length).toFixed(2)} %), relleno ${fMin}..${fMax} m`);
  const nodataPct = (100 * nod) / out.length;
  console.log(`Válidos ${n}, nodata ${nod} (${nodataPct.toFixed(2)} %), min ${min}, max ${max}, media ${mean?.toFixed(2)}`);

  // 5) Escribir GeoTIFF y verificar lectura
  mkdirSync(outDir, { recursive: true });
  const tifPath = join(outDir, `${baseName}_${res}m.tif`);
  const tifBuf = writeFloat32GeoTiff(out, {
    width, height, originX: ox, originY: oy, pixelSize: res, epsg: 3031, nodata: NODATA,
    citation: 'WGS 84 / Antarctic Polar Stereographic',
    description: `REMA Mosaics v2.0 ${res} m crop, ${placeLabel}. Heights in metres above the WGS84 ellipsoid. Source: PGC, CC BY 4.0.`,
  });
  writeFileSync(tifPath, tifBuf);
  const fileBuf = readFileSync(tifPath);
  const rb = await fromArrayBuffer(fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.length));
  const rimg = await rb.getImage();
  const [rband] = await rimg.readRasters({ samples: [0] });
  let mismatch = 0;
  for (let i = 0; i < out.length; i++) if (!Object.is(rband[i], out[i])) mismatch++;
  const rk = rimg.getGeoKeys();
  const readBack = {
    pixels_mismatch: mismatch,
    epsg: rk.ProjectedCSTypeGeoKey,
    origin: rimg.getOrigin(),
    resolution: rimg.getResolution(),
    nodata: rimg.getGDALNoData(),
    size: [rimg.getWidth(), rimg.getHeight()],
  };
  console.log('Verificación de lectura:', JSON.stringify(readBack));
  if (mismatch) throw new Error('El GeoTIFF escrito no coincide con los datos');
  const sha256 = createHash('sha256').update(tifBuf).digest('hex');
  const countPath = join(outDir, `${baseName}_${res}m_count.tif`);
  writeFileSync(countPath, writeUint8GeoTiff(countOut, {
    width, height, originX: ox, originY: oy, pixelSize: res, epsg: 3031, nodata: 0,
    citation: 'WGS 84 / Antarctic Polar Stereographic',
    description: `REMA Mosaics v2.0 ${res} m "count" asset crop: number of DEM strips per pixel (0 = no strip / filled or nodata).`,
  }));

  // 6) Vistas previas reducidas (máx. ~1000 px, promedio por bloques; solo para inspección visual):
  //    PNG 16 bits con alturas normalizadas min..max (0 = nodata) + sombreado 8 bits.
  //    Orientación: filas = norte de la grilla EPSG:3031 arriba (el norte geográfico apunta arriba-izquierda).
  const f = Math.max(1, Math.ceil(Math.max(width, height) / 1000));
  const pw = Math.floor(width / f), ph = Math.floor(height / f);
  const hsFull = hillshade(out, width, height, res, NODATA);
  const png16 = new Uint16Array(pw * ph);
  const hs = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      let s = 0, sh = 0, k = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
        const o = (y * f + j) * width + x * f + i;
        if (out[o] === NODATA) continue;
        s += out[o]; sh += hsFull[o]; k++;
      }
      png16[y * pw + x] = k ? 1 + Math.round(((s / k - min) / (max - min)) * 65534) : 0;
      hs[y * pw + x] = k ? Math.max(1, Math.round(sh / k)) : 0;
    }
  }
  const pngPath = join(outDir, `${baseName}_${res}m_preview16.png`);
  writeFileSync(pngPath, encodeGrayPng(png16, pw, ph, 16, {
    Comment: `REMA v2.0 ${res}m reduced x${f} (${pw}x${ph}, ${res * f} m/px); gray 1..65535 = ${min.toFixed(3)}..${max.toFixed(3)} m (WGS84 ellipsoid); 0 = nodata`,
  }));
  const hsPath = join(outDir, `${baseName}_${res}m_hillshade.png`);
  writeFileSync(hsPath, encodeGrayPng(hs, pw, ph, 8, { Comment: `Hillshade az 315 alt 45, reduced x${f}; 0 = nodata` }));
  // cuantización de los valores de origen (se observó paso de 1/128 m)
  let q128 = 0;
  for (const v of out) if (v !== NODATA && Number.isInteger(v * 128)) q128++;

  // 7) Puntos de referencia: muestreo directo (vecino más cercano)
  const samples = refPoints.map((p) => {
    const [x, y] = to3031.forward([p.lon, p.lat]);
    const c = Math.floor((x - ox) / res);
    const r = Math.floor((oy - y) / res);
    const inside = c >= 0 && r >= 0 && c < width && r < height;
    const v = inside ? out[r * width + c] : null;
    return { ...p, x_3031: Math.round(x * 100) / 100, y_3031: Math.round(y * 100) / 100, inside_crop: inside, rema_ellipsoidal_m: v === NODATA ? null : v };
  });

  // 8) Metadatos
  const meta = {
    dataset: 'Reference Elevation Model of Antarctica (REMA) — Mosaics',
    version: STAC.version,
    product: `REMA v2.0 DEM mosaic, ${res} m`,
    producer: 'Polar Geospatial Center (PGC), University of Minnesota / Byrd Polar and Climate Research Center',
    observation_type: 'Observación: modelo digital de superficie (DSM) fotogramétrico (SETSM) a partir de imágenes estéreo Maxar/Vantor WorldView/GeoEye; compuesto multitemporal registrado a altimetría satelital (CryoSat-2, ICESat).',
    retrieval_date: RETRIEVAL_DATE,
    run_timestamp_utc: new Date().toISOString(),
    access: {
      method: 'HTTP range requests (Cloud Optimized GeoTIFF) desde el bucket público AWS Open Data, sin credenciales',
      stac_root: STAC.root,
      aws_registry: 'https://registry.opendata.aws/pgc-rema/',
      bytes_fetched_approx: bytesFetched,
      http_requests: requests,
      tiles_used: tilesUsed,
      tiles_missing_in_catalog: missing,
      overlap_between_tiles: { pixels_compared: overlapN, max_abs_diff_m: overlapMaxDiff, mean_abs_diff_m: overlapN ? overlapSumDiff / overlapN : null, rule: 'se conserva el primer valor válido en el orden de tiles_used' },
    },
    output: {
      file: `data/rema/${baseName}_${res}m.tif`,
      bytes: statSync(tifPath).size,
      sha256,
      format: 'GeoTIFF (TIFF clásico), float32, 1 banda, DEFLATE + predictor 3, tiras de 16 filas',
      read_back_check: readBack,
      previews_note: `Reducidas x${f} (${pw}x${ph} px, ${res * f} m/px). Solo inspección visual, no usar como dato.`,
      previews: [`data/rema/${baseName}_${res}m_preview16.png`, `data/rema/${baseName}_${res}m_hillshade.png`],
    },
    resolution_m: res,
    crs: { epsg: 3031, name: 'WGS 84 / Antarctic Polar Stereographic', proj4: EPSG3031 },
    geotransform_gdal: [ox, res, 0, oy, 0, -res],
    pixel_is: 'area',
    width,
    height,
    bbox_requested_epsg3031: bbox,
    bbox_epsg3031: outBbox,
    bbox_wgs84: llEnvelope(outBbox),
    nodata_value: NODATA,
    nodata_pixels: nod,
    nodata_percent: Math.round(nodataPct * 1000) / 1000,
    valid_pixels: n,
    elevation_stats_m: { min, max, mean, note: 'Incluye la superficie del mar aplanada por PGC (~22 m elipsoidales); ver measured_vs_filled.land_ice_stats_m para tierra/hielo.' },
    measured_vs_filled: {
      explanation: 'Según PGC, REMA v2 usó la costa del Antarctic Digital Database para enmascarar datos de mala calidad sobre el océano y "add the sea surface height". Por eso el recorte no tiene nodata: el mar tiene un valor de relleno casi constante (~22 m elipsoidales). Comprobado en este recorte: count = 0 solo marca bloques sin ninguna tira (mar abierto); dentro de la caleta el agua también está aplanada aunque count > 0. Para separar mar de tierra se usa además la heurística sea_surface_flat_heuristic.',
      source: 'https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/',
      pixels_count_gt0: mN,
      percent_count_gt0: Math.round((100000 * mN) / out.length) / 1000,
      land_ice_stats_m: lN ? { pixels: lN, percent: Math.round((100000 * lN) / out.length) / 1000, min: lMin, max: lMax, mean: lSum / lN, rule: 'count > 0 y no marcado por sea_surface_flat_heuristic' } : null,
      filled_pixels_count0: filled,
      filled_percent: Math.round((100000 * filled) / out.length) / 1000,
      filled_value_range_m: filled ? [fMin, fMax] : null,
      count_histogram: countHist,
      count_raster: `data/rema/${baseName}_${res}m_count.tif`,
      sea_surface_flat_heuristic: {
        rule: `valor en [${SEA_LO}, ${SEA_HI}] m elipsoidales y rango de la vecindad 3x3 < 0.05 m`,
        pixels: flat,
        percent: Math.round((100000 * flat) / out.length) / 1000,
        of_which_count0: flatC0,
        caveat: isPotter
          ? 'Estimación; no es una máscara oficial. La costa usada por PGC (ADD) puede no reflejar la posición actual del frente del glaciar Fourcade.'
          : 'Estimación; no es una máscara oficial. La franja se centra en la ondulación del geoide local (EGM96), que es donde PGC dejó el relleno del mar en caleta Potter; no está documentado que sea igual en todas partes.',
      },
    },
    units: 'metros',
    value_quantization: { multiples_of_1_128_m_percent: Math.round((100000 * q128) / n) / 1000, note: 'Los valores de origen son múltiplos de 1/128 m (~0.8 cm), propio de los COG de PGC; no lo introduce este script.' },
    vertical_reference: {
      datum: 'Altura elipsoidal sobre el elipsoide WGS84 (no es altura sobre el nivel del mar).',
      evidence: 'PGC (https://www.pgc.umn.edu/data/rema/): los DEM de PGC están referidos al elipsoide WGS84; los servicios Esri convierten a alturas ortométricas con EGM2008.',
      to_msl: isPotter
        ? 'Para "metros sobre el nivel del mar" aproximado: H = h_REMA - N_EGM2008. En caleta Potter N_EGM2008 ≈ 21.8 m (GeographicLib GeoidEval, ver sanity-check). El nivel medio del mar real difiere además del geoide por la topografía dinámica oceánica y las mareas.'
        : 'Para "metros sobre el nivel del mar" aproximado: H = h_REMA - N_EGM2008, con N consultado en GeographicLib GeoidEval para este lugar (ver <nombre>_check.json). El nivel medio del mar real difiere además del geoide por la topografía dinámica oceánica y las mareas.',
    },
    temporal_note: isPotter
      ? 'El mosaico combina tiras de distintas fechas (ver item_start_datetime/item_end_datetime por tesela). El frente del glaciar Fourcade ha retrocedido; el recorte no representa un instante único.'
      : 'El mosaico combina tiras de distintas fechas (ver item_start_datetime/item_end_datetime por tesela); el recorte no representa un instante único.',
    reference_points_sampled: samples,
    license: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) según el catálogo STAC de PGC y el AWS Open Data Registry',
    citation: {
      dataset: `Howat, Ian, et al., 2022, "The Reference Elevation Model of Antarctica – Mosaics, Version 2", https://doi.org/10.7910/DVN/EBW8UC, Harvard Dataverse, V1, [Accessed ${RETRIEVAL_DATE}].`,
      acknowledgement: 'DEMs provided by the Byrd Polar and Climate Research Center and the Polar Geospatial Center under NSF-OPP awards 1043681, 1542736, 1543501, 1559691, 1810976, and 2129685.',
      aws: `Reference Elevation Model of Antarctica (REMA) was accessed on ${RETRIEVAL_DATE} from https://registry.opendata.aws/pgc-rema.`,
      policy: 'https://www.pgc.umn.edu/guides/user-services/acknowledgement-policy/',
    },
    place: placeLabel,
    processing: 'Recorte por ventana en la grilla nativa (sin remuestreo, sin relleno de huecos, sin suavizado). Script: pipeline/rema/fetch-potter-cove.mjs',
  };
  const jsonPath = join(outDir, `${baseName}_${res}m.json`);
  writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
  console.log(`Escrito: ${tifPath} (${(meta.output.bytes / 2 ** 20).toFixed(2)} MiB)`);
  console.log(`Escrito: ${jsonPath}`);
  console.log(`Escrito: ${pngPath}, ${hsPath}`);
  console.log(`Transferido ~${(bytesFetched / 2 ** 20).toFixed(1)} MiB en ${requests} pedidos HTTP`);
  console.table(samples.map((s) => ({ key: s.key, inside: s.inside_crop, h_ellipsoid: s.rema_ellipsoidal_m })));
}

function hillshade(z, w, h, cell, nodata) {
  const out = new Uint8Array(w * h);
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const at = (x, y) => z[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = z[y * w + x];
      if (c === nodata) continue;
      const g = (xx, yy) => { const v = at(xx, yy); return v === nodata ? c : v; };
      const dzdx = (g(x + 1, y) - g(x - 1, y)) / (2 * cell);
      const dzdy = (g(x, y - 1) - g(x, y + 1)) / (2 * cell);
      // normal (x=este, y=norte) · luz (azimut horario desde el norte)
      const nz = 1 / Math.hypot(dzdx, dzdy, 1);
      const v = (-dzdx * Math.sin(az) * Math.cos(alt) - dzdy * Math.cos(az) * Math.cos(alt) + Math.sin(alt)) * nz;
      out[y * w + x] = Math.max(1, Math.round(255 * Math.max(0, v)));
    }
  }
  return out;
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
