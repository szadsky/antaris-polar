// Profundidad de las montañas con Depth Anything V2 Small (Apache-2.0), una pasada por capa y a más resolución.
//
// La pasada sobre la imagen completa (generar-profundidad.mjs) deja las montañas en el 2 % más lejano del rango
// (la loma y el pingüino se llevan casi todo) y a ~0,55 px de modelo por píxel. Aquí:
//  - cumbres: el modelo ve solo cielo + cumbres (capas 01 + 02). Así las partes de las cumbres que las laderas tapan
//    en la referencia (reconstruidas en la capa) también tienen profundidad propia, y no la de las laderas;
//  - laderas: ve cielo + cumbres + laderas + agua (01 + 02 + 03 + 04), sin barcos ni terreno;
//  - cada pasada es un recorte de la franja de montañas con lado corto 518 px (el del entrenamiento), unas 3 veces
//    más resolución que la pasada completa.
// Cada resultado se normaliza dentro del alfa de su capa (percentiles 1–99) y se guardan juntos:
//   public/hero/profundidad-montanas.webp   R = cumbres · G = laderas, filas 140–540 de la referencia, 1672 px de ancho
//   public/hero/relieve-montanas.webp       relieve local (profundidad − su versión suavizada a ~18 px, ×4, 128 = 0):
//                                           R = cumbres · G = laderas. Da volumen propio a cada cresta y falda, no solo
//                                           el degradado de atrás hacia adelante; el panel decide cuánto se usa.
//   profundidad/montanas-cumbres.png, montanas-laderas.png, montanas.json   (documentación)
//   node scripts/profundidad-montanas.mjs
import { pipeline, env, RawImage } from '@huggingface/transformers';
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const W = 1672, CAPAS = here('../fuente/capas/');
const ROWS = [140, 540]; // franja que se publica (la que usa el shader)
const MODEL = 'onnx-community/depth-anything-v2-small';
env.cacheDir = here('../.cache-modelos');
env.allowLocalModels = false;

const t0 = performance.now();
const estimator = await pipeline('depth-estimation', MODEL, { dtype: 'fp32', device: 'cpu' });
const tLoad = performance.now() - t0;

const PASSES = [
  { name: 'cumbres', layers: ['01-cielo.png', '02-cumbres-nevadas.png'], crop: [110, 480], mask: '02-cumbres-nevadas.png', maxRow: 452 },
  { name: 'laderas', layers: ['01-cielo.png', '02-cumbres-nevadas.png', '04-canal-beagle.png', '03-laderas-y-bruma.png'], crop: [110, 640], mask: '03-laderas-y-bruma.png', maxRow: 498 },
];

const out = Buffer.alloc(W * (ROWS[1] - ROWS[0]) * 3);
const relief = Buffer.alloc(W * (ROWS[1] - ROWS[0]) * 3, 128);
const RELIEF_SIGMA = 18, RELIEF_GAIN = 4;
const report = { modelo: MODEL, licenciaModelo: 'Apache-2.0', runtime: 'transformers.js + onnxruntime-node (CPU), fp32', cargaMs: Math.round(tLoad), pasadas: [] };
mkdirSync(here('../profundidad'), { recursive: true });

for (const [channel, p] of PASSES.entries()) {
  const [y0, y1] = p.crop, h = y1 - y0;
  // composición de las capas (en el orden del zip; el agua va debajo de las laderas) y recorte
  const base = sharp(CAPAS + p.layers[0]).composite(p.layers.slice(1).map((f) => ({ input: CAPAS + f })));
  const crop = await sharp(await base.png().toBuffer()).extract({ left: 0, top: y0, width: W, height: h }).removeAlpha().png().toBuffer();
  const scale = 518 / h, iw = Math.round((W * scale) / 14) * 14, ih = Math.round((h * scale) / 14) * 14;
  Object.assign(estimator.processor.image_processor, { size: { width: iw, height: ih }, keep_aspect_ratio: false, do_resize: true });
  const t1 = performance.now();
  const { predicted_depth } = await estimator(await RawImage.fromBlob(new Blob([crop])));
  const ms = performance.now() - t1;
  const [dh, dw] = predicted_depth.dims.slice(-2);
  if (dw !== W || dh !== h) throw new Error(`salida ${dw}×${dh}, esperada ${W}×${h}`);
  const d = predicted_depth.data;
  // normalización dentro del alfa de la capa
  const { data: alpha } = await sharp(CAPAS + p.mask).extractChannel(3).raw().toBuffer({ resolveWithObject: true });
  const vals = [];
  // solo sobre la costa lejana (fila 498): el agua al pie de las laderas se llevaba todo el rango «cerca»
  for (let y = Math.max(y0, ROWS[0]); y < Math.min(y1, ROWS[1], p.maxRow); y++) for (let x = 0; x < W; x += 2) if (alpha[y * W + x] > 200) vals.push(d[(y - y0) * W + x]);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.01)], hi = vals[Math.floor(vals.length * 0.99)];
  const vis = Buffer.alloc(W * (ROWS[1] - ROWS[0]));
  for (let y = ROWS[0]; y < ROWS[1]; y++) for (let x = 0; x < W; x++) {
    const v = y >= y0 && y < y1 ? Math.min(1, Math.max(0, (d[(y - y0) * W + x] - lo) / (hi - lo))) : 0;
    vis[(y - ROWS[0]) * W + x] = Math.round(v * 255);
  }
  // mediana 7 × 7: borra los restos finos (mástiles pintados en la capa 03) sin correr los bordes de las crestas;
  // desenfoque 1,5 px: la malla elástica estira de forma pareja donde la profundidad salta
  const med = await sharp(vis, { raw: { width: W, height: ROWS[1] - ROWS[0], channels: 1 } }).median(7).blur(1.5).extractChannel(0).raw().toBuffer(); // 1 canal: después de blur, sharp devuelve 3
  med.copy(vis);
  for (let i = 0; i < vis.length; i++) out[i * 3 + channel] = vis[i];
  // relieve local: lo que sobresale (cerca) o se hunde (lejos) respecto de su entorno de ~18 px, solo dentro de la capa
  // Convolución normalizada por el alfa: el entorno se promedia solo con píxeles de la capa (sin el «afuera» en 0,
  // que hacía ver todo el borde como cercano).
  const HH = ROWS[1] - ROWS[0], m = Buffer.alloc(W * HH), vm = Buffer.alloc(W * HH);
  for (let y = ROWS[0]; y < ROWS[1]; y++) for (let x = 0; x < W; x++) { const i = (y - ROWS[0]) * W + x, a = alpha[y * W + x] >= 128 ? 1 : 0; m[i] = a * 255; vm[i] = a * vis[i]; }
  const blurRaw = async (buf) => sharp(buf, { raw: { width: W, height: HH, channels: 1 } }).blur(RELIEF_SIGMA).extractChannel(0).raw().toBuffer();
  const [softVM, softM] = await Promise.all([blurRaw(vm), blurRaw(m)]);
  for (let i = 0; i < W * HH; i++) {
    if (!m[i] || softM[i] < 8) continue;
    const soft = (softVM[i] * 255) / softM[i];
    relief[i * 3 + channel] = Math.round(Math.min(255, Math.max(0, 128 + (vis[i] - soft) * RELIEF_GAIN)));
  }
  await sharp(vis, { raw: { width: W, height: ROWS[1] - ROWS[0], channels: 1 } }).png({ compressionLevel: 9 }).toFile(here(`../profundidad/montanas-${p.name}.png`));
  report.pasadas.push({ capa: p.name, capas: p.layers, recorteFilas: p.crop, tamanoModelo: [iw, ih], inferenciaMs: Math.round(ms), normalizacion: `percentiles 1–99 dentro del alfa de la capa, filas < ${p.maxRow}`, rangoCrudo: [lo, hi] });
  console.log(p.name, iw + '×' + ih, Math.round(ms) + ' ms');
}
// B sin uso (128): una sola imagen RGB para el navegador
for (let i = 0; i < out.length / 3; i++) out[i * 3 + 2] = 128;
// a media resolución: la malla elástica la lee cada 8 × 6 px
await sharp(out, { raw: { width: W, height: ROWS[1] - ROWS[0], channels: 3 } }).resize(W / 2, (ROWS[1] - ROWS[0]) / 2).webp({ lossless: true }).toFile(here('../public/hero/profundidad-montanas.webp')); // sin pérdida: con pérdida, el submuestreo de color (4:2:0) guardaba R y G a media resolución
await sharp(relief, { raw: { width: W, height: ROWS[1] - ROWS[0], channels: 3 } }).resize(W / 2, (ROWS[1] - ROWS[0]) / 2).webp({ lossless: true }).toFile(here('../public/hero/relieve-montanas.webp'));
report.salida = { archivo: 'public/hero/profundidad-montanas.webp', filas: ROWS, canales: 'R = cumbres · G = laderas (0 = lejos, 1 = cerca)' };
report.relieve = { archivo: 'public/hero/relieve-montanas.webp', filas: ROWS, calculo: `(profundidad − desenfoque gaussiano σ ${RELIEF_SIGMA} px) × ${RELIEF_GAIN}, 128 = 0, dentro del alfa de la capa`, canales: 'R = cumbres · G = laderas' };
report.fecha = new Date().toISOString();
writeFileSync(here('../profundidad/montanas.json'), JSON.stringify(report, null, 2));
