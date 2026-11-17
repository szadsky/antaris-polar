// Peso del build (dist/): bytes de cada archivo y transferencia aproximada (gzip nivel 9 en archivos de texto;
// imágenes, KTX2, GLB y WASM tal cual). Correr después de `npm run build`.  node scripts/medir-peso.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const TEXT = /\.(js|mjs|json|bin|html|css|txt|svg)$/;
let total = 0, transfer = 0, hero = 0, panelBytes = 0;
const rows = walk('dist').map((f) => {
  const b = readFileSync(f), t = TEXT.test(f) ? gzipSync(b, { level: 9 }).length : b.length;
  total += b.length; transfer += t;
  // LICENSES no se descarga al cargar la página; el panel (DialKit) solo con ?panel o en desarrollo
  const isPanel = /[\\/]assets[\\/]panel-/.test(f);
  // De las fuentes el navegador baja solo el .woff2 del subconjunto latino (unicode-range); el resto queda de reserva.
  const unusedFont = /\.woff$/.test(f) || (/\.woff2$/.test(f) && !/-latin-\d/.test(f));
  if (!f.includes('LICENSES') && !f.endsWith('estatica-render.webp') && !isPanel && !unusedFont) hero += t;
  if (isPanel) panelBytes += t;
  return [f.replace(/\\/g, '/'), b.length, t];
}).sort((a, b) => b[2] - a[2]);
for (const [f, b, t] of rows) console.log(String(t).padStart(9), String(b).padStart(9), f);
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`\nTotal en disco ${kb(total)} · transferencia aprox. ${kb(transfer)} · escena 3D (sin licencias, imagen fija ni panel) ${kb(hero)} · panel ${kb(panelBytes)}`);
