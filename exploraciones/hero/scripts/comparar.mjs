// Compara una captura del canvas (capturas/<nombre>.png, tomada en el navegador de la app) con la referencia:
//   capturas/<nombre>-lado-a-lado.png  referencia | captura (misma escala)
//   capturas/<nombre>-detalle.png      recorte del pingüino y la loma, referencia arriba, captura abajo
// e imprime la diferencia media por zona (0–255, promedio de |ΔR|,|ΔG|,|ΔB|).
//   node scripts/comparar.mjs <nombre>
import sharp from 'sharp';

const name = process.argv[2] ?? 'hero';
const REF = 'fuente/referencia-tercera.png', CAP = `capturas/${name}.png`;
const W = 1672, H = 941;
const ref = await sharp(REF).removeAlpha().resize(W, H).raw().toBuffer();
const cap = await sharp(CAP).removeAlpha().resize(W, H).raw().toBuffer();

const zones = { cielo: [0, 0, W, 150], montanas: [0, 150, W, 500], agua: [0, 500, W, 740], loma: [0, 790, W, H], pinguino: [770, 595, 875, 760] };
const diff = {};
for (const [k, [x0, y0, x1, y1]] of Object.entries(zones)) {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 3; s += Math.abs(ref[i] - cap[i]) + Math.abs(ref[i + 1] - cap[i + 1]) + Math.abs(ref[i + 2] - cap[i + 2]); n += 3; }
  diff[k] = +(s / n).toFixed(1);
}

const label = async (text, w) => sharp(Buffer.from(`<svg width="${w}" height="34"><rect width="100%" height="100%" fill="#0e1a2b"/><text x="12" y="23" font-family="Segoe UI, Arial" font-size="18" fill="#fff">${text}</text></svg>`)).png().toBuffer();
const side = await sharp({ create: { width: W * 2 + 12, height: H + 34, channels: 3, background: '#0e1a2b' } })
  .composite([
    { input: await label('Referencia (referencia-tercera.png)', W), left: 0, top: 0 },
    { input: await label(`Captura del navegador de la app (${name})`, W), left: W + 12, top: 0 },
    { input: REF, left: 0, top: 34 },
    { input: await sharp(CAP).resize(W, H).png().toBuffer(), left: W + 12, top: 34 },
  ]).png().toFile(`capturas/${name}-lado-a-lado.png`);

const crop = { left: 520, top: 560, width: 640, height: 381 };
await sharp({ create: { width: crop.width * 2 + 8, height: crop.height, channels: 3, background: '#0e1a2b' } })
  .composite([
    { input: await sharp(REF).extract(crop).png().toBuffer(), left: 0, top: 0 },
    { input: await sharp(CAP).resize(W, H).extract(crop).png().toBuffer(), left: crop.width + 8, top: 0 },
  ]).png().toFile(`capturas/${name}-detalle.png`);

console.log({ captura: CAP, diferenciaMedia: diff, ladoALado: side.width + '×' + side.height });
