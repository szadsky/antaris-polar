#!/usr/bin/env node
/**
 * Recortes REMA 2 m + costa SCAR ADD para cada base antártica argentina (COMNAP nov 2024).
 *
 * Para cada base:
 *   1. Recuadro de 8×8 km en EPSG:3031 centrado en la base.
 *   2. Ondulación del geoide (EGM2008/EGM96) en la base, vía GeographicLib GeoidEval.
 *   3. Recorte REMA con fetch-potter-cove.mjs (mismo procedimiento verificado en caleta Potter).
 *   4. Control: altura REMA en la base − N vs. altura publicada por COMNAP.
 *   5. Costa ADD v7.12 alta resolución del recuadro (+500 m).
 *
 * Uso: node fetch-bases.mjs [--only id1,id2] [--skip-existing]
 * No inventa datos: si una base no tiene cobertura, queda registrado como bloqueo.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import { EPSG3031 } from './config.mjs';
import { clipEsriPolygons } from './lib/clip-coast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const remaDir = join(root, 'data', 'rema');
const coastDir = join(root, 'data', 'costa');
mkdirSync(coastDir, { recursive: true });
proj4.defs('EPSG:3031', EPSG3031);
const to3031 = proj4('EPSG:4326', 'EPSG:3031');

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const skipExisting = argv.includes('--skip-existing');
const HALF_M = 4000;
const ADD_HIGH =
  'https://services7.arcgis.com/tPxy1hrFDhJfZ0Mf/arcgis/rest/services/High_resolution_vector_polygons_of_the_Antarctic_coastline/FeatureServer/1';

const { bases } = JSON.parse(readFileSync(join(root, 'prototipos', 'terreno-3d', 'public', 'map', 'antartida.json'), 'utf8'));
const todo = bases.filter((b) => b.id !== 'carlini' && (!only || only.includes(b.id)));
const summary = [];

for (const b of todo) {
  console.log(`\n══ ${b.nombre} (${b.id}) ══`);
  const tif = join(remaDir, `${b.id}_2m.tif`);
  const entry = { id: b.id, nombre: b.nombre };
  try {
    // 1) recuadro
    const [x, y] = to3031.forward([b.lon, b.lat]);
    const bbox = [x - HALF_M, y - HALF_M, x + HALF_M, y + HALF_M].map((v) => Math.round(v / 2) * 2);
    entry.bbox_epsg3031 = bbox;

    // 2) geoide
    const geoid = await geoidAt(b.lat, b.lon);
    entry.geoid = geoid;
    console.log(`  geoide EGM2008 ${geoid.egm2008} m · EGM96 ${geoid.egm96} m`);

    // 3) REMA
    if (!(skipExisting && existsSync(tif))) {
      const refs = join(remaDir, `${b.id}_refs.json`);
      writeFileSync(
        refs,
        JSON.stringify([
          {
            key: b.id,
            name: b.nombre,
            lon: b.lon,
            lat: b.lat,
            source: `COMNAP Antarctic Facilities nov 2024: elevación publicada ${b.elevacionM} m (${b.elevacionDatum})`,
          },
        ])
      );
      const band = `${(geoid.egm96 - 2).toFixed(2)},${(geoid.egm96 + 2).toFixed(2)}`;
      const r = spawnSync(
        process.execPath,
        [join(here, 'fetch-potter-cove.mjs'), '--name', b.id, '--res', '2', '--bbox', bbox.join(','), '--label', `${b.nombre} (8×8 km centrados en la base)`, '--refs', refs, '--sea-band', band],
        { cwd: here, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      );
      process.stdout.write(r.stdout.split('\n').filter((l) => /SIN ítem|Válidos|Escrito: .*tif|Transferido|BLOQUEO|Error/.test(l)).map((l) => `  ${l}\n`).join(''));
      if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' | '));
    }

    // 4) control de altura en la base
    const meta = JSON.parse(readFileSync(join(remaDir, `${b.id}_2m.json`), 'utf8'));
    const s = meta.reference_points_sampled[0];
    const h = s.rema_ellipsoidal_m;
    const H = h == null ? null : round2(h - geoid.egm2008);
    entry.rema = {
      nodata_percent: meta.nodata_percent,
      min: meta.elevation_stats_m.min,
      max: meta.elevation_stats_m.max,
      tiles: meta.access.tiles_used.map((t) => t.item_id),
      tiles_missing: meta.access.tiles_missing_in_catalog.map((t) => t.id),
      fechas: meta.access.tiles_used.map((t) => [t.item_start_datetime?.slice(0, 10), t.item_end_datetime?.slice(0, 10)]),
      sea_flat_percent: meta.measured_vs_filled.sea_surface_flat_heuristic.percent,
    };
    entry.altura_en_base = {
      rema_h_elipsoidal_m: h,
      rema_H_aprox_msnm_egm2008: H,
      comnap_publicada_m: b.elevacionM,
      comnap_datum: b.elevacionDatum,
      diferencia_m: H == null || b.elevacionM == null ? null : round2(H - b.elevacionM),
      nota: 'REMA es un modelo de SUPERFICIE (incluye edificios/nieve) y la coordenada COMNAP es un punto aproximado de la base; se esperan diferencias de algunos metros.',
    };
    writeFileSync(join(remaDir, `${b.id}_check.json`), JSON.stringify({ fecha: new Date().toISOString(), geoid_source: 'GeographicLib GeoidEval online', ...entry }, null, 2));
    console.log(`  altura en la base: REMA ≈ ${H ?? '—'} m s.n.m. vs COMNAP ${b.elevacionM} m · nodata ${meta.nodata_percent} %`);

    // 5) costa ADD alta resolución
    const env = { xmin: bbox[0] - 500, ymin: bbox[1] - 500, xmax: bbox[2] + 500, ymax: bbox[3] + 500, spatialReference: { wkid: 3031 } };
    const q = new URLSearchParams({
      geometry: JSON.stringify(env),
      geometryType: 'esriGeometryEnvelope',
      inSR: '3031',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      outSR: '3031',
      returnGeometry: 'true',
      f: 'json',
    });
    const full = await (await fetch(`${ADD_HIGH}/query?${q}`)).json();
    if (full.error) throw new Error(`ADD: ${JSON.stringify(full.error)}`);
    // El servicio devuelve polígonos completos (el continente entero si se toca, ~83 MB): se recorta al recuadro.
    const coast = clipEsriPolygons(full, [env.xmin, env.ymin, env.xmax, env.ymax]);
    writeFileSync(join(coastDir, `${b.id}.json`), JSON.stringify(coast));
    writeFileSync(
      join(coastDir, `${b.id}.meta.json`),
      JSON.stringify(
        {
          label: 'SCAR ADD v7.12 (2025)',
          layer: 'add_coastline_high_res_polygon_v7_12',
          serviceUrl: ADD_HIGH,
          query: { envelope: env, outSR: 3031 },
          clipped: { to: [env.xmin, env.ymin, env.xmax, env.ymax], method: 'Sutherland–Hodgman por anillo (pipeline/rema/lib/clip-coast.mjs)' },
          retrievedAt: new Date().toISOString().slice(0, 10),
          citation: 'SCAR Antarctic Digital Database, 2025, https://doi.org/qc9x',
          licence: 'CC BY 4.0 (inferida de fichas del ADD de versiones previas; confirmar para v7.12)',
          features: coast.features.length,
          surfaces: [...new Set(coast.features.map((f) => f.attributes.surface))],
        },
        null,
        2
      )
    );
    entry.costa = { poligonos: coast.features.length, superficies: [...new Set(coast.features.map((f) => f.attributes.surface))] };
    console.log(`  costa ADD: ${coast.features.length} polígonos (${entry.costa.superficies.join(', ') || 'ninguno: todo mar o todo fuera'})`);
    entry.ok = true;
  } catch (e) {
    entry.ok = false;
    entry.error = String(e.message ?? e);
    console.log(`  ✗ BLOQUEO: ${entry.error}`);
  }
  summary.push(entry);
}

writeFileSync(join(remaDir, 'bases-summary.json'), JSON.stringify({ fecha: new Date().toISOString(), bases: summary }, null, 2));
console.log(`\nListo: ${summary.filter((s) => s.ok).length}/${summary.length} bases. Resumen en data/rema/bases-summary.json`);

async function geoidAt(lat, lon) {
  const raw = await (await fetch(`https://geographiclib.sourceforge.io/cgi-bin/GeoidEval?input=${lat}+${lon}`)).text();
  const html = raw.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
  const val = (m) => Number(html.match(new RegExp(`${m}\\s*=\\s*(-?[0-9.]+)`))?.[1]);
  const g = { egm2008: val('EGM2008'), egm96: val('EGM96') };
  if (!Number.isFinite(g.egm2008) || !Number.isFinite(g.egm96)) throw new Error('GeoidEval no devolvió valores');
  return g;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
