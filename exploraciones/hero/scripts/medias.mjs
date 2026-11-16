// Color medio por zona (referencia vs captura), solo diagnóstico.  node scripts/medias.mjs <nombre>
import sharp from 'sharp';
const W = 1672, H = 941, name = process.argv[2];
const ref = await sharp('fuente/referencia-tercera.png').removeAlpha().raw().toBuffer();
const cap = await sharp(`capturas/${name}.png`).removeAlpha().resize(W, H).raw().toBuffer();
const t7 = await sharp('fuente/capas/07-terreno-nevado.png').ensureAlpha().raw().toBuffer();
const zones = { horizonte: [0, 480, W, 520], aguaLejos: [0, 520, W, 620], aguaCerca: [0, 620, W, 740], lomaIzq: [0, 800, 600, H], lomaCentro: [600, 760, 1100, H], lomaDer: [1100, 800, W, H], montanasBajas: [0, 400, W, 480] };
for (const [k, [x0, y0, x1, y1]] of Object.entries(zones)) {
  const a = [0, 0, 0], b = [0, 0, 0]; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x; if (k.startsWith('loma') && t7[i * 4 + 3] < 200) continue; for (let c = 0; c < 3; c++) { a[c] += ref[i * 3 + c]; b[c] += cap[i * 3 + c]; } n++; }
  console.log(k.padEnd(14), 'ref', a.map((v) => Math.round(v / n)).join(','), '  captura', b.map((v) => Math.round(v / n)).join(','));
}
