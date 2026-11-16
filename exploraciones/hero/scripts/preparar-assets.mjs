// Prepara los recursos de la página a partir de las capas del zip (fuente/capas).
// Todo fuera del navegador.
//   node scripts/preparar-assets.mjs
import sharp from 'sharp';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { IMG, F_PX, CAM_H, HORIZON_ROW } from './camara.mjs';

const W = IMG.w, H = IMG.h, OUT = 'public/hero', CAPAS = 'fuente/capas';
mkdirSync(OUT, { recursive: true });
const rgba = async (f) => (await sharp(`${CAPAS}/${f}`).ensureAlpha().raw().toBuffer());
// (la profundidad de DA V2 ya no se usa aquí: montañas → profundidad-montanas.mjs; la loma se genera en src/terrain.ts)
const report = { bytes: {} };
const size = (f) => (report.bytes[f] = statSync(`${OUT}/${f}`).size);

// ── 1. Capas pintadas que se publican (cielo, cumbres, laderas) ─────────────────────────────────────────
await sharp(`${CAPAS}/01-cielo.png`).removeAlpha().webp({ quality: 84 }).toFile(`${OUT}/cielo.webp`); size('cielo.webp');
// Recortes verticales (solo las filas con contenido) para no publicar transparencia.
const CROPS = { cumbres: [140, 452], laderas: [320, 540] };
for (const [name, file] of [['cumbres', '02-cumbres-nevadas.png'], ['laderas', '03-laderas-y-bruma.png']]) {
  const [y0, y1] = CROPS[name];
  await sharp(`${CAPAS}/${file}`).extract({ left: 0, top: y0, width: W, height: y1 - y0 }).webp({ quality: 86, alphaQuality: 90 }).toFile(`${OUT}/${name}.webp`); size(`${name}.webp`);
}

// ── 2. Profundidad de las montañas: la genera scripts/profundidad-montanas.mjs (una pasada de DA V2 por capa) ──

// ── 3. Barcos y boyas: componentes de la capa 06 → atlas + línea de flotación ─────────────────────────────
{
  const b = await rgba('06-barcos-y-boyas.png');
  const solid = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) solid[i] = b[i * 4 + 3] > 20 ? 1 : 0;
  const R = 5, dil = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid[y * W + x]) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) dil[yy * W + xx] = 1; }
  const lab = new Int32Array(W * H).fill(-1), comps = [];
  for (let i = 0; i < W * H; i++) {
    if (!dil[i] || lab[i] >= 0) continue;
    const id = comps.length; let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0; const st = [i]; lab[i] = id;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0;
      if (solid[j]) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && dil[k] && lab[k] < 0 && Math.abs((k % W) - x) <= 1) { lab[k] = id; st.push(k); }
    }
    if (n > 0) comps.push({ id, x0, y0, x1, y1, n });
  }
  // Línea de flotación: última fila con al menos 30 % del ancho máximo opaco (no la punta de un cabo o una boya).
  for (const c of comps) {
    let maxRow = 0; const rows = [];
    for (let y = c.y0; y <= c.y1; y++) { let k = 0; for (let x = c.x0; x <= c.x1; x++) if (solid[y * W + x] && lab[y * W + x] === c.id) k++; rows.push(k); maxRow = Math.max(maxRow, k); }
    let wl = c.y1; while (wl > c.y0 && rows[wl - c.y0] < maxRow * 0.3) wl--;
    c.flotacion = wl + 1;
  }
  // Atlas por filas (2 px de margen), cada sprite con su alfa original y solo los píxeles de su componente.
  const pad = 2, atlasW = 1024; let ax = 0, ay = 0, rowH = 0;
  const sprites = [];
  for (const c of comps.sort((p, q) => (q.y1 - q.y0) - (p.y1 - p.y0))) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (ax + w + pad > atlasW) { ax = 0; ay += rowH + pad; rowH = 0; }
    sprites.push({ ...c, w, h, ax, ay }); ax += w + pad; rowH = Math.max(rowH, h);
  }
  const atlasH = ay + rowH, atlas = Buffer.alloc(atlasW * atlasH * 4);
  for (const s of sprites) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const si = (s.y0 + y) * W + s.x0 + x; if (lab[si] !== s.id) continue;
    const di = ((s.ay + y) * atlasW + s.ax + x) * 4; for (let k = 0; k < 4; k++) atlas[di + k] = b[si * 4 + k];
  }
  await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 4 } }).webp({ quality: 88, alphaQuality: 95 }).toFile(`${OUT}/barcos.webp`); size('barcos.webp');
  writeFileSync(`${OUT}/barcos.json`, JSON.stringify({ atlas: [atlasW, atlasH], sprites: sprites.map(({ x0, y0, w, h, ax, ay, flotacion }) => ({ x: x0, y: y0, w, h, ax, ay, flotacion })) }));
  report.barcos = sprites.length;
}

// ── 4. Color del agua por fila (mediana de la capa 04 sin reflejos pintados, barcos ni terreno) ───────────
{
  const w4 = await rgba('04-canal-beagle.png'), r5 = await rgba('05-reflejos-de-barcos.png'), b6 = await rgba('06-barcos-y-boyas.png'), t7 = await rgba('07-terreno-nevado.png');
  const first = 501, last = 860, rows = [];
  for (let y = first; y <= last; y++) {
    const cs = [[], [], []];
    for (let x = 0; x < W; x++) { const i = y * W + x; if (w4[i * 4 + 3] < 250 || r5[i * 4 + 3] > 3 || b6[i * 4 + 3] > 3 || t7[i * 4 + 3] > 3) continue; for (let k = 0; k < 3; k++) cs[k].push(w4[i * 4 + k]); }
    rows.push(cs[0].length > 20 ? cs.map((c) => (c.sort((p, q) => p - q), c[c.length >> 1])) : null);
  }
  for (let i = 1; i < rows.length; i++) if (!rows[i]) rows[i] = rows[i - 1]; // filas tapadas por el terreno
  for (let i = rows.length - 2; i >= 0; i--) if (!rows[i]) rows[i] = rows[i + 1]; // primera fila (costa)
  // Media móvil de ±6 filas: la mediana por fila trae ruido que en el agua se veía como bandas horizontales.
  const smooth = rows.map((_, i) => [0, 1, 2].map((k) => { let s = 0, n = 0; for (let d = -6; d <= 6; d++) { const j = Math.min(rows.length - 1, Math.max(0, i + d)); s += rows[j][k]; n++; } return Math.round(s / n); }));
  rows.splice(0, rows.length, ...smooth);
  writeFileSync(`${OUT}/agua-filas.json`, JSON.stringify({ primera: first, filas: rows }));
}

// ── 5. Base nevada: máscaras de la capa 07 (la loma se GENERA en el navegador, src/terrain.ts) ───────────────
// R = roca (gris oscuro, L < 0,26; la nieve en sombra llega a 0,4–0,6) · G = pasto seco · B = cobertura (alfa de 07).
// Con ellas el terreno ajusta su silueta (primera fila sin pasto de cada columna) y pone roca donde la capa la pintó.
{
  const t7 = await rgba('07-terreno-nevado.png');
  const Y0 = 736, MH = H - Y0, mask = Buffer.alloc(W * MH * 3);
  for (let y = Y0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, o = ((y - Y0) * W + x) * 3, R = t7[i * 4] / 255, G = t7[i * 4 + 1] / 255, B = t7[i * 4 + 2] / 255, A = t7[i * 4 + 3];
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B, mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx > 0 ? (mx - mn) / mx : 0;
    const grass = R > B + 0.06 && R >= G - 0.02 && sat > 0.18 ? Math.min(1, (sat - 0.18) / 0.15) : 0;
    const rock = grass < 0.5 ? Math.min(1, Math.max(0, (0.36 - L) / 0.1)) : 0;
    mask[o] = Math.round(rock * 255); mask[o + 1] = Math.round(grass * 255); mask[o + 2] = A;
  }
  await sharp(mask, { raw: { width: W, height: MH, channels: 3 } }).blur(0.6).webp({ lossless: true }).toFile(`${OUT}/base-mascaras.webp`); size('base-mascaras.webp');
  // pies del pingüino en la referencia (centro de la capa 08 y su fila más baja)
  report.base = { pies: [822, 757], mascaraFilas: [Y0, H], pinguinoM: 0.95, pinguinoPx: 162 };
}

// ── 6. Pasto seco: matas recortadas de la capa 07 (solo sus píxeles de pasto) → atlas + pie de cada mata ──────
{
  const t7 = await rgba('07-terreno-nevado.png');
  const grassAt = (i) => {
    const R = t7[i * 4] / 255, G = t7[i * 4 + 1] / 255, B = t7[i * 4 + 2] / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx > 0 ? (mx - mn) / mx : 0;
    return t7[i * 4 + 3] > 128 && R > B + 0.06 && R >= G - 0.02 && sat > 0.16 ? Math.min(1, (sat - 0.16) / 0.12) : 0;
  };
  const g = new Float32Array(W * H);
  for (let y = 700; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = grassAt(y * W + x);
  // matas: componentes del pasto dilatado 4 px; se descartan las de menos de 40 píxeles
  const R = 4, dil = new Uint8Array(W * H);
  for (let y = 700; y < H; y++) for (let x = 0; x < W; x++) if (g[y * W + x] > 0.3) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) dil[yy * W + xx] = 1; }
  const lab = new Int32Array(W * H).fill(-1), tufts = [];
  for (let i = 0; i < W * H; i++) {
    if (!dil[i] || lab[i] >= 0) continue;
    const id = tufts.length; let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0; const st = [i]; lab[i] = id;
    while (st.length) {
      const j = st.pop(), x = j % W, y = (j / W) | 0;
      if (g[j] > 0.3) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && dil[k] && lab[k] < 0 && Math.abs((k % W) - x) <= 1) { lab[k] = id; st.push(k); }
    }
    if (n >= 40) tufts.push({ id, x0: Math.max(0, x0 - 2), y0: Math.max(0, y0 - 2), x1: Math.min(W - 1, x1 + 2), y1: Math.min(H - 1, y1 + 2), n });
  }
  const pad = 2, atlasW = 1024; let ax = 0, ay = 0, rowH = 0;
  const sprites = [];
  for (const c of tufts.sort((p, q) => (q.y1 - q.y0) - (p.y1 - p.y0))) {
    const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
    if (ax + w + pad > atlasW) { ax = 0; ay += rowH + pad; rowH = 0; }
    sprites.push({ ...c, w, h, ax, ay }); ax += w + pad; rowH = Math.max(rowH, h);
  }
  const atlasH = ay + rowH, atlas = Buffer.alloc(atlasW * atlasH * 4);
  for (const s of sprites) for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const si = (s.y0 + y) * W + s.x0 + x; if (lab[si] !== s.id) continue;
    const a = Math.min(1, g[si] * 1.6), di = ((s.ay + y) * atlasW + s.ax + x) * 4;
    atlas[di] = t7[si * 4]; atlas[di + 1] = t7[si * 4 + 1]; atlas[di + 2] = t7[si * 4 + 2]; atlas[di + 3] = Math.round(a * 255);
  }
  await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 4 } }).webp({ quality: 88, alphaQuality: 90 }).toFile(`${OUT}/pasto.webp`); size('pasto.webp');
  // Pie por tiras de 16 px: las matas largas siguen la loma en diagonal; cada tira se apoya a la profundidad de
  // su punto más bajo (donde toca la nieve).
  const STRIP = 16;
  const pies = (s) => { const out = []; for (let sx = 0; sx < s.w; sx += STRIP) { let pie = -1; for (let y = s.h - 1; y >= 0 && pie < 0; y--) for (let x = sx; x < Math.min(s.w, sx + STRIP); x++) { const si = (s.y0 + y) * W + s.x0 + x; if (lab[si] === s.id && g[si] > 0.3) { pie = s.y0 + y; break; } } out.push(pie); } for (let k = 0; k < out.length; k++) if (out[k] < 0) out[k] = out[k - 1] ?? out.find((p) => p >= 0) ?? s.y0 + s.h - 1; return out; };
  writeFileSync(`${OUT}/pasto.json`, JSON.stringify({ atlas: [atlasW, atlasH], tira: STRIP, sprites: sprites.map((s) => ({ x: s.x0, y: s.y0, w: s.w, h: s.h, ax: s.ax, ay: s.ay, pies: pies(s) })) }));
  report.pasto = sprites.length;
}

const meta = { imagen: [W, H], fPx: F_PX, horizonte: HORIZON_ROW, camaraAlturaM: CAM_H, crops: CROPS, ...report };
writeFileSync(`${OUT}/escena.json`, JSON.stringify(meta, null, 1));
console.log(JSON.stringify(meta, null, 1));
