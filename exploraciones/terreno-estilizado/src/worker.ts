/**
 * Web Worker del terreno estilizado. A partir de UNA grilla de alturas REMA arma:
 *   - malla submuestreada (cada `stride` muestras);
 *   - surface (resolución completa, RGBA8): R,G normal (x,z) Sobel · B cavidades · A clase
 *     (0 sin dato · 128 mar según costa ADD · 255 tierra/hielo);
 *   - light (resolución de malla, RGBA8): R sombra del sol (255 = al sol) · G cercanía a la
 *     costa (255 en la línea de costa → 0 a SHORE_M) · B,A sin uso.
 * Nada de esto se descarga. Las sombras corresponden a un sol fijo (interpretación).
 */

export type Vec3 = [number, number, number];

export interface BuildMsg {
  type: "build";
  key: string;
  bin: ArrayBuffer;
  mask: ArrayBuffer | null;
  width: number;
  height: number;
  cellSizeM: number;
  stepM: number;
  stride: number;
  exaggeration: number;
  sun: Vec3;
}
export interface UpdateMsg {
  type: "update";
  key: string;
  exaggeration: number;
  sun: Vec3;
}
export interface BuiltMsg {
  type: "built";
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  index: Uint32Array;
  surface: Uint8Array;
  light: Uint8Array;
  heightsM: Float32Array;
  mesh: { width: number; height: number };
  seaLevelM: number | null;
  ms: { decode: number; surface: number; light: number; mesh: number };
}
export interface UpdatedMsg {
  type: "updated";
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  surface: Uint8Array;
  light: Uint8Array;
  ms: { light: number };
}

interface Grid {
  w: number;
  h: number;
  cell: number;
  stride: number;
  heights: Float32Array;
  land: Uint8Array | null;
  cavity: Uint8Array;
  shore: Uint8Array; // a resolución de malla
}

const SHORE_M = 160;
const grids = new Map<string, Grid>();
const post = (m: unknown, t: Transferable[]) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = async (e: MessageEvent<BuildMsg | UpdateMsg>) => {
  try {
    const msg = e.data;
    if (msg.type === "build") {
      const t0 = performance.now();
      const raw = await gunzipMaybe(msg.bin);
      const land = msg.mask ? await gunzipMaybe(msg.mask) : null;
      const q = decodeDeltaPlanar(raw, msg.width);
      const heights = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) heights[i] = q[i] === 0 ? NaN : (q[i] - 1) * msg.stepM;
      dequantize(heights, msg.width, msg.height, msg.stepM, 12);
      const t1 = performance.now();

      const cavity = cavityShade(heights, msg.width, msg.height, msg.cellSizeM);
      const shore = shoreProximity(land, msg.width, msg.height, msg.stride, msg.cellSizeM);
      const g: Grid = { w: msg.width, h: msg.height, cell: msg.cellSizeM, stride: msg.stride, heights, land, cavity, shore };
      grids.set(msg.key, g);
      const surface = surfaceTexture(g, msg.exaggeration);
      const t2 = performance.now();
      const light = lightTexture(g, msg.exaggeration, msg.sun);
      const t3 = performance.now();
      const m = meshFrom(g, msg.exaggeration);
      const heightsCopy = heights.slice();
      const out: BuiltMsg = {
        type: "built",
        key: msg.key,
        ...m,
        surface,
        light,
        heightsM: heightsCopy,
        seaLevelM: seaLevel(heights, land),
        ms: { decode: t1 - t0, surface: t2 - t1, light: t3 - t2, mesh: performance.now() - t3 },
      };
      post(out, [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.index.buffer, surface.buffer, light.buffer, heightsCopy.buffer]);
    } else {
      const g = grids.get(msg.key);
      if (!g) return;
      const surface = surfaceTexture(g, msg.exaggeration);
      const t0 = performance.now();
      const light = lightTexture(g, msg.exaggeration, msg.sun);
      const ms = { light: performance.now() - t0 };
      const { positions, normals } = meshFrom(g, msg.exaggeration, false);
      const out: UpdatedMsg = { type: "updated", key: msg.key, positions, normals, surface, light, ms };
      post(out, [positions.buffer, normals.buffer, surface.buffer, light.buffer]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) }, []);
  }
};

// ─── Superficie (resolución completa) ──────────────────────
function surfaceTexture(g: Grid, k: number): Uint8Array {
  const { w, h, cell, heights, land, cavity } = g;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const isSea = land ? land[i] === 0 : false;
      let nx = 0;
      let nz = 0;
      if (!isSea) [nx, nz] = sobelNormalXZ(heights, w, h, x, y, cell, k);
      out[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = cavity[i];
      out[i * 4 + 3] = Number.isNaN(heights[i]) ? 0 : isSea ? 128 : 255;
    }
  }
  return out;
}

/**
 * Normal por operador de Sobel (3×3): promedia el gradiente de tres filas/columnas.
 * Frente a las diferencias centrales simples, atenúa el ruido residual de la
 * cuantización, que la exageración vertical amplificaba en franjas.
 */
function sobelNormalXZ(hs: Float32Array, w: number, h: number, x: number, y: number, cell: number, k: number) {
  const c = hs[y * w + x];
  const at = (xx: number, yy: number) => {
    xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
    yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
    const v = hs[yy * w + xx];
    return v === v ? v : c === c ? c : 0;
  };
  const a = at(x - 1, y - 1), b = at(x, y - 1), cc = at(x + 1, y - 1);
  const d = at(x - 1, y), f = at(x + 1, y);
  const g = at(x - 1, y + 1), hh = at(x, y + 1), i = at(x + 1, y + 1);
  const dx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cell);
  const dz = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * cell);
  const nx = -dx * k;
  const nz = -dz * k;
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, nz / len];
}

// ─── Luz (resolución de malla) ─────────────────────────────
/**
 * Sombra del sol por marcha de rayos sobre el relieve: desde cada celda se avanza
 * hacia el sol con pasos crecientes (8 m → ~6 km) y se compara la altura del rayo con
 * la del terreno. Penumbra suave proporcional a la distancia. Sol fijo: se recalcula
 * solo si cambia la exageración vertical.
 */
function lightTexture(g: Grid, k: number, sun: Vec3): Uint8Array {
  const { w, h, cell, stride, heights, shore } = g;
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const mc = cell * stride;
  // Alturas a resolución de malla (NaN → 0)
  const H = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const v = heights[y * stride * w + x * stride];
    H[y * mw + x] = v === v ? v * k : 0;
  }
  const horiz = Math.hypot(sun[0], sun[2]);
  const dx = sun[0] / horiz; // dirección en la grilla: x → columnas, z → filas
  const dz = sun[2] / horiz;
  const tanE = sun[1] / horiz;
  const sample = (fx: number, fz: number) => {
    // bilineal en coordenadas de celda
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 >= mw - 1 || z0 >= mh - 1) return -Infinity;
    const tx = fx - x0, tz = fz - z0;
    const i = z0 * mw + x0;
    return (H[i] * (1 - tx) + H[i + 1] * tx) * (1 - tz) + (H[i + mw] * (1 - tx) + H[i + mw + 1] * tx) * tz;
  };
  const out = new Uint8Array(mw * mh * 4);
  const maxDist = 6000;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x;
      const h0 = H[i] + 1.5; // sesgo: evita autosombra por ruido
      let lit = 1;
      for (let d = mc; d < maxDist; d *= 1.09) {
        const ht = sample(x + (dx * d) / mc, y + (dz * d) / mc);
        if (ht === -Infinity) break;
        const ray = h0 + d * tanE;
        if (ht > ray) {
          lit = 0;
          break;
        }
        // penumbra: cuánto margen deja el terreno respecto del rayo, relativo a la distancia
        lit = Math.min(lit, ((ray - ht) / (d * 0.035)));
      }
      out[i * 4] = Math.round(Math.max(0, Math.min(1, lit)) * 255);
      out[i * 4 + 1] = shore[i];
      out[i * 4 + 3] = 255;
    }
  }
  return out;
}

/** Cercanía a la línea de costa (distancia de chaflán, dos pasadas, O(n)). */
function shoreProximity(land: Uint8Array | null, w: number, h: number, stride: number, cell: number): Uint8Array {
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const out = new Uint8Array(mw * mh);
  if (!land) return out;
  const L = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) L[y * mw + x] = land[y * stride * w + x * stride];
  const INF = 1e9;
  const D = new Float32Array(mw * mh).fill(INF);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const i = y * mw + x;
    const v = L[i];
    if ((x > 0 && L[i - 1] !== v) || (x < mw - 1 && L[i + 1] !== v) || (y > 0 && L[i - mw] !== v) || (y < mh - 1 && L[i + mw] !== v)) D[i] = 0;
  }
  const s2 = Math.SQRT2;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const i = y * mw + x;
    if (x > 0) D[i] = Math.min(D[i], D[i - 1] + 1);
    if (y > 0) D[i] = Math.min(D[i], D[i - mw] + 1);
    if (x > 0 && y > 0) D[i] = Math.min(D[i], D[i - mw - 1] + s2);
    if (x < mw - 1 && y > 0) D[i] = Math.min(D[i], D[i - mw + 1] + s2);
  }
  for (let y = mh - 1; y >= 0; y--) for (let x = mw - 1; x >= 0; x--) {
    const i = y * mw + x;
    if (x < mw - 1) D[i] = Math.min(D[i], D[i + 1] + 1);
    if (y < mh - 1) D[i] = Math.min(D[i], D[i + mw] + 1);
    if (x < mw - 1 && y < mh - 1) D[i] = Math.min(D[i], D[i + mw + 1] + s2);
    if (x > 0 && y < mh - 1) D[i] = Math.min(D[i], D[i + mw - 1] + s2);
  }
  const mc = cell * stride;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, 1 - (D[i] * mc) / SHORE_M) * 255);
  return out;
}

/** Nivel del relleno de mar de REMA (mediana de las alturas marcadas como mar). */
function seaLevel(hs: Float32Array, land: Uint8Array | null): number | null {
  if (!land) return null;
  const s: number[] = [];
  for (let i = 0; i < hs.length; i += 97) if (land[i] === 0 && hs[i] === hs[i]) s.push(hs[i]);
  if (s.length < 10) return null;
  s.sort((a, b) => a - b);
  return s[s.length >> 1];
}

// ─── Cavidades y des-cuantización (igual que terreno-nitidez) ─
function cavityShade(hs: Float32Array, w: number, h: number, cell: number): Uint8Array {
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1));
  const cnt = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rc = 0;
    for (let x = 0; x < w; x++) {
      const v = hs[y * w + x];
      if (v === v) (rs += v), rc++;
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + rs;
      cnt[(y + 1) * W1 + x + 1] = cnt[y * W1 + x + 1] + rc;
    }
  }
  const radiiM = [8, 24, 64], depthM = [1.5, 4, 10], weight = [0.35, 0.35, 0.3];
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const v = hs[i];
    if (v !== v) { out[i] = 255; continue; }
    let occ = 0;
    for (let s = 0; s < 3; s++) {
      const r = Math.max(1, Math.round(radiiM[s] / cell));
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const S = sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0];
      const C = cnt[y1 * W1 + x1] - cnt[y0 * W1 + x1] - cnt[y1 * W1 + x0] + cnt[y0 * W1 + x0];
      occ += weight[s] * Math.min(1, Math.max(0, (S / C - v) / depthM[s]));
    }
    out[i] = Math.round((1 - 0.55 * occ) * 255);
  }
  return out;
}

function dequantize(hs: Float32Array, w: number, h: number, step: number, iterations: number) {
  const lo = new Float32Array(hs.length), hi = new Float32Array(hs.length), tmp = new Float32Array(hs.length);
  for (let i = 0; i < hs.length; i++) (lo[i] = hs[i] - step / 2), (hi[i] = hs[i] + step / 2);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = hs[r + xx];
          if (v === v) (s += v), n++;
        }
        tmp[r + x] = n ? s / n : NaN;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (hs[i] !== hs[i]) continue;
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const v = tmp[yy * w + x];
        if (v === v) (s += v), n++;
      }
      const m = s / n;
      hs[i] = m < lo[i] ? lo[i] : m > hi[i] ? hi[i] : m;
    }
  }
}

// ─── Malla ─────────────────────────────────────────────────
function meshFrom(g: Grid, k: number, withTopology = true) {
  const { w, h, cell, stride, heights } = g;
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const halfW = ((w - 1) * cell) / 2, halfD = ((h - 1) * cell) / 2;
  const n = mw * mh;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(withTopology ? n * 2 : 0);
  for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
    const j = my * mw + mx, x = mx * stride, y = my * stride;
    const v = heights[y * w + x];
    positions[j * 3] = x * cell - halfW;
    positions[j * 3 + 1] = v === v ? v * k : 0;
    positions[j * 3 + 2] = y * cell - halfD;
    const [nx, nz] = sobelNormalXZ(heights, w, h, x, y, cell * 1, k);
    const ny = Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz));
    normals[j * 3] = nx; normals[j * 3 + 1] = ny; normals[j * 3 + 2] = nz;
    if (withTopology) { uvs[j * 2] = (x + 0.5) / w; uvs[j * 2 + 1] = (y + 0.5) / h; }
  }
  let index = new Uint32Array(0);
  if (withTopology) {
    index = new Uint32Array((mw - 1) * (mh - 1) * 6);
    let t = 0;
    for (let y = 0; y < mh - 1; y++) for (let x = 0; x < mw - 1; x++) {
      const a = x + mw * y, b = x + mw * (y + 1), c = x + 1 + mw * (y + 1), d = x + 1 + mw * y;
      index[t++] = a; index[t++] = b; index[t++] = d; index[t++] = b; index[t++] = c; index[t++] = d;
    }
  }
  return { positions, normals, uvs, index, mesh: { width: mw, height: mh } };
}

// ─── Decodificación ────────────────────────────────────────
async function gunzipMaybe(buf: ArrayBuffer): Promise<Uint8Array> {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function decodeDeltaPlanar(buf: Uint8Array, w: number): Uint16Array {
  const n = buf.length / 2;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const d = (buf[i] << 8) | buf[n + i];
    const prev = i % w ? out[i - 1] : i >= w ? out[i - w] : 0;
    out[i] = (prev + d) & 0xffff;
  }
  return out;
}
