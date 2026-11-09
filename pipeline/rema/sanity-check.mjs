#!/usr/bin/env node
// Control de cordura de alturas del recorte REMA contra valores publicados.
// Uso: node sanity-check.mjs [--res 2]
// Lee data/rema/potter-cove_<res>m.tif (local) y escribe data/rema/potter-cove_<res>m_sanity.json.

import { fromFile } from 'geotiff';
import proj4 from 'proj4';
import { writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPSG3031, RETRIEVAL_DATE } from './config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const resArg = process.argv.indexOf('--res');
const res = resArg > 0 ? Number(process.argv[resArg + 1]) : 2;
const dataDir = resolve(here, '../../data/rema');
proj4.defs('EPSG:3031', EPSG3031);
const to3031 = proj4('EPSG:4326', 'EPSG:3031');

// Ondulación del geoide N (m sobre el elipsoide WGS84), consultada el 2026-11-08 en
// GeographicLib GeoidEval online: https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=<lat>+<lon>
// (EGM2008 y EGM96 interpolados por GeoidEval 2.5.2). Altura ortométrica aprox.: H = h - N.
const GEOID = {
  carlini: { lat: -62.237778, lon: -58.664444, egm2008: 21.7949, egm96: 22.0009 },
  potter_cove: { lat: -62.233806, lon: -58.6845, egm2008: 21.7887, egm96: 21.9887 },
  three_brothers_gbr: { lat: -62.243111, lon: -58.674444, egm2008: 21.8212, egm96: 22.0005 },
  fourcade: { lat: -62.216, lon: -58.665972, egm2008: 21.7014, egm96: 21.9797 },
  corner_ul: { lat: -62.180002, lon: -58.639193, egm2008: 21.5619, egm96: 21.9445 },
  corner_lr: { lat: -62.275569, lon: -58.688981, egm2008: 21.9215, egm96: 22.0112 },
  corner_ll: { lat: -62.216124, lon: -58.766397, egm2008: 21.765, egm96: 21.9232 },
  corner_ur: { lat: -62.239357, lon: -58.5616, egm2008: 21.7805, egm96: 22.0367 },
};

const tiff = await fromFile(join(dataDir, `potter-cove_${res}m.tif`));
const img = await tiff.getImage();
const [z] = await img.readRasters({ samples: [0] });
const W = img.getWidth();
const H = img.getHeight();
const [ox, oy] = img.getOrigin();
const NODATA = img.getGDALNoData();

const pix = (lon, lat) => {
  const [x, y] = to3031.forward([lon, lat]);
  return { c: Math.floor((x - ox) / res), r: Math.floor((oy - y) / res), x, y };
};
const at = (c, r) => (c >= 0 && r >= 0 && c < W && r < H ? z[r * W + c] : null);
function neighborhood(lon, lat, radiusM) {
  const { c, r } = pix(lon, lat);
  const k = Math.ceil(radiusM / res);
  const vals = [];
  let best = { v: -Infinity };
  for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
    if ((dr * dr + dc * dc) * res * res > radiusM * radiusM) continue;
    const v = at(c + dc, r + dr);
    if (v === null || v === NODATA) continue;
    vals.push(v);
    if (v > best.v) best = { v, c: c + dc, r: r + dr };
  }
  vals.sort((a, b) => a - b);
  const [bx, by] = [ox + (best.c + 0.5) * res, oy - (best.r + 0.5) * res];
  const bll = proj4('EPSG:3031', 'EPSG:4326').forward([bx, by]);
  return {
    radius_m: radiusM,
    n: vals.length,
    min: vals[0],
    median: vals[Math.floor(vals.length / 2)],
    max: best.v,
    max_location: { x_3031: bx, y_3031: by, lon: +bll[0].toFixed(6), lat: +bll[1].toFixed(6), offset_from_point_m: Math.round(Math.hypot(bx - pix(lon, lat).x, by - pix(lon, lat).y)) },
  };
}
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

const checks = [];

// 1) Superficie del mar en la caleta
{
  const g = GEOID.potter_cove;
  const p = pix(g.lon, g.lat);
  const v = at(p.c, p.r);
  const nb = neighborhood(g.lon, g.lat, 200);
  checks.push({
    id: 'sea_surface_potter_cove',
    point: 'Potter Cove (SCAR CGA name_id 110689)',
    rema_h_ellipsoid_m: v,
    neighborhood_200m: { min: nb.min, median: nb.median, max: nb.max },
    egm2008_N_m: g.egm2008,
    egm96_N_m: g.egm96,
    rema_minus_egm2008_m: r2(v - g.egm2008),
    rema_minus_egm96_m: r2(v - g.egm96),
    verdict:
      'Coherente con superficie del mar (h ≈ N). PERO es un valor de relleno de PGC (máscara de costa + "sea surface height"), no una medición del agua: no sirve como verificación independiente del DEM. El modelo de superficie usado no está documentado en la guía consultada; empíricamente coincide mejor con EGM96 que con EGM2008.',
  });
}
// Rellenos en las esquinas (si son agua)
for (const key of ['corner_lr', 'corner_ur', 'corner_ll', 'corner_ul']) {
  const g = GEOID[key];
  const p = pix(g.lon, g.lat);
  const c = Math.min(W - 1, Math.max(0, p.c));
  const r = Math.min(H - 1, Math.max(0, p.r));
  const v = at(c, r);
  checks.push({ id: `fill_vs_geoid_${key}`, rema_h_ellipsoid_m: v, egm2008_N_m: g.egm2008, egm96_N_m: g.egm96, rema_minus_egm2008_m: r2(v - g.egm2008), rema_minus_egm96_m: r2(v - g.egm96), note: 'Si h ≈ 22 m y la zona es plana, es mar (relleno); si no, es tierra/hielo y la comparación no aplica.' });
}

// 2) Cerro Tres Hermanos / Three Brothers Hill
{
  const g = GEOID.three_brothers_gbr;
  const nb = neighborhood(g.lon, g.lat, 500);
  const Hmax = nb.max - g.egm2008;
  checks.push({
    id: 'three_brothers_hill',
    published: [
      { value_m: 195, source: 'SCAR CGA name_id 111576 (GBR): "rising to 195m"' },
      { value_m: 210, source: 'SCAR CGA name_id 132669 (USA): altitude 210 m' },
      { value_m: 213, source: 'SCAR CGA name_id 106381 (CHL): "Cerro conspicuo de 213 metros de altura"' },
    ],
    published_vertical_datum: 'No especificado en el gazetteer (se asume nivel del mar / cartográfico).',
    search: 'máximo de REMA en un radio de 500 m del punto GBR (las coordenadas del gazetteer son aproximadas)',
    rema_max_h_ellipsoid_m: nb.max,
    rema_max_location: nb.max_location,
    rema_max_H_egm2008_m: r2(Hmax),
    diff_vs_published_m: { '195': r2(Hmax - 195), '210': r2(Hmax - 210), '213': r2(Hmax - 213) },
  });
}

// 3) Base Carlini
{
  const g = GEOID.carlini;
  const p = pix(g.lon, g.lat);
  const v = at(p.c, p.r);
  const nb = neighborhood(g.lon, g.lat, 100);
  checks.push({
    id: 'carlini_station',
    published: { value_m: 10, source: 'SCAR CGA name_id 136127 (USA): altitude 10 m' },
    rema_h_ellipsoid_m: v,
    rema_H_egm2008_m: r2(v - g.egm2008),
    neighborhood_100m_H_egm2008_m: { min: r2(nb.min - g.egm2008), median: r2(nb.median - g.egm2008), max: r2(nb.max - g.egm2008) },
    note: 'REMA es un modelo de superficie (DSM): incluye edificios. El punto del gazetteer es aproximado y la base ocupa varias hectáreas sobre la costa.',
  });
}

// 4) Glaciar Fourcade (solo informativo; no hay altura publicada para comparar)
{
  const g = GEOID.fourcade;
  const p = pix(g.lon, g.lat);
  const v = at(p.c, p.r);
  checks.push({ id: 'fourcade_point', rema_h_ellipsoid_m: v, rema_H_egm2008_m: r2(v - g.egm2008), note: 'Sin valor publicado de referencia; el punto del gazetteer es un nombre de glaciar, no una cota.' });
}

const report = {
  file: `data/rema/potter-cove_${res}m.tif`,
  date: RETRIEVAL_DATE,
  geoid_source: 'GeographicLib GeoidEval online (https://geographiclib.sourceforge.io/cgi-bin/GeoidEval), consultado 2026-11-08',
  checks,
};
const outPath = join(dataDir, `potter-cove_${res}m_sanity.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Escrito: ${outPath}`);
