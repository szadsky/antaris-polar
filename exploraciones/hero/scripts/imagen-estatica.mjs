// Imagen fija del hero (public/hero/estatica-render.webp): se ve al instante mientras carga el 3D, queda sin WebGL y es la
// alternativa sin movimiento. Sale del RENDER FINAL, no de las capas del zip: antes era la recomposición de la
// referencia y al recargar se veían un momento el pingüino pintado y la loma original.
//
// Cómo regenerarla: con `npm run dev`, abrir http://127.0.0.1:3420/?referencia&dpr=1, esperar la escena y en la consola
// `await __heroCapture('estatica-render')` (guarda capturas/estatica-render.png, 1672 × 941). Después:
//   node scripts/imagen-estatica.mjs
import sharp from 'sharp';

const src = 'capturas/estatica-render.png';
const out = 'public/hero/estatica-render.webp';
const meta = await sharp(src).metadata();
if (meta.width !== 1672 || meta.height !== 941) throw new Error(`La captura tiene que ser de 1672 × 941 (es ${meta.width} × ${meta.height})`);
const info = await sharp(src).removeAlpha().webp({ quality: 82, effort: 6 }).toFile(out);
console.log(`${out}: ${(info.size / 1024).toFixed(0)} KB`);
