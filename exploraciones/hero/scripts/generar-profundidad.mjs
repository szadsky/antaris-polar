// Profundidad relativa con Depth Anything V2 (Small), corrida localmente en Node con ONNX Runtime (CPU).
// Modelo: onnx-community/depth-anything-v2-small (exportación ONNX de depth-anything/Depth-Anything-V2-Small-hf,
// licencia Apache-2.0). Los modelos Base y Large son CC-BY-NC-4.0: no se usan.
// Entrada: la imagen de referencia completa (la escena tal como se pintó). Salida: PNG en escala de grises de 16 bits
// (más claro = más cerca; disparidad relativa normalizada 0–1) en 8 bits para la página, y una copia Float32 + un JSON con parámetros y tiempos.
//   node scripts/generar-profundidad.mjs [entrada] [salida.png]
import { pipeline, env, RawImage } from '@huggingface/transformers';
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, basename } from 'node:path';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const input = process.argv[2] ?? here('../fuente/referencia-tercera.png');
const output = process.argv[3] ?? here('../profundidad/profundidad-referencia.png');
const MODEL = 'onnx-community/depth-anything-v2-small';
const DTYPE = 'fp32';
// Lado corto de la entrada al modelo (múltiplo de 14). El modelo se entrenó a 518; más resolución da bordes
// más finos en las cumbres a cambio de tiempo de CPU.
const SHORT_SIDE = Number(process.env.LADO ?? 518);

env.cacheDir = here('../.cache-modelos');
env.allowLocalModels = false;

const t0 = performance.now();
const estimator = await pipeline('depth-estimation', MODEL, { dtype: DTYPE, device: 'cpu' });
const tLoad = performance.now() - t0;

const meta = await sharp(input).metadata();
const W = meta.width, H = meta.height;
const scale = SHORT_SIDE / Math.min(W, H);
const iw = Math.round((W * scale) / 14) * 14, ih = Math.round((H * scale) / 14) * 14;
// Se ajusta el tamaño del procesador para no deformar la imagen (keep_aspect_ratio con múltiplos de 14).
estimator.processor.image_processor.size = { width: iw, height: ih };
estimator.processor.image_processor.keep_aspect_ratio = false;
estimator.processor.image_processor.do_resize = true;

const image = await RawImage.read(input);
const t1 = performance.now();
const { predicted_depth } = await estimator(image);
const tInfer = performance.now() - t1;

// predicted_depth: [h, w] (disparidad relativa, más grande = más cerca)
const [dh, dw] = predicted_depth.dims.slice(-2);
const raw = predicted_depth.data;
let lo = Infinity, hi = -Infinity;
for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
const f32 = new Float32Array(raw.length);
for (let i = 0; i < raw.length; i++) f32[i] = (raw[i] - lo) / (hi - lo);
// Copia en coma flotante para los scripts (no se publica): datos/profundidad-referencia.f32 (${dw}×${dh}).
mkdirSync(here('../datos'), { recursive: true });
writeFileSync(here('../datos/profundidad-referencia.f32'), Buffer.from(f32.buffer));
if (dw !== W || dh !== H) throw new Error('La salida del modelo no tiene el tamaño de la imagen');
// Versión 8 bits para la web (la que carga la página).
const u8 = Buffer.from(Uint8Array.from(f32, (v) => Math.round(v * 255)));
await sharp(u8, { raw: { width: dw, height: dh, channels: 1 } }).resize(W, H, { kernel: 'cubic' }).png({ compressionLevel: 9 }).toFile(output);

const info = {
  modelo: MODEL, fuenteOriginal: 'depth-anything/Depth-Anything-V2-Small-hf', licenciaModelo: 'Apache-2.0',
  runtime: 'transformers.js + onnxruntime-node (CPU)', precision: DTYPE,
  entrada: basename(input), entradaSha256: createHash('sha256').update(readFileSync(input)).digest('hex'),
  tamanoEntrada: [W, H], tamanoModelo: [iw, ih], salidaModelo: [dw, dh],
  normalizacion: 'disparidad relativa (min–max) a 0–1; claro = cerca. No es profundidad métrica.',
  rangoCrudo: [lo, hi], cargaMs: Math.round(tLoad), inferenciaMs: Math.round(tInfer),
  fecha: new Date().toISOString(),
};
writeFileSync(output.replace(/\.png$/, '.json'), JSON.stringify(info, null, 2));
console.log(info);
