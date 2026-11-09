/**
 * Web Worker: a partir de UNA grilla de alturas arma
 *   - la malla (submuestreada: cada `stride` muestras) → geometría liviana para la GPU;
 *   - la "textura de superficie" a resolución completa (RGBA8):
 *       R,G  normal (x, z) del terreno → luz por píxel
 *       B    sombreado de cavidades (1 = expuesto, <1 = encajonado) → profundidad
 *       A    clase: 0 sin dato · 128 mar (costa ADD) · 255 tierra/hielo
 * Nada de esto se descarga: sale de las alturas reales.
 */

export interface BuildMsg {
  type: "build";
  key: string;
  bin: ArrayBuffer;
  mask: ArrayBuffer | null;
  width: number;
  height: number;
  cellSizeM: number;
  minM: number;
  stepM: number;
  stride: number;
  exaggeration: number;
}
export interface ExaggerateMsg {
  type: "exaggerate";
  key: string;
  exaggeration: number;
}
export interface BuiltMsg {
  type: "built";
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  index: Uint32Array;
  surface: Uint8Array;
  heightsM: Float32Array;
  mesh: { width: number; height: number };
  ms: { decode: number; surface: number; mesh: number };
}
export interface ExaggeratedMsg {
  type: "exaggerated";
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  surface: Uint8Array;
}

interface Grid {
  w: number;
  h: number;
  cell: number;
  stride: number;
  heights: Float32Array; // m relativos a minM, NaN = sin dato
  land: Uint8Array | null;
  cavity: Uint8Array; // independiente de la exageración
}
const grids = new Map<string, Grid>();
const post = (m: unknown, t: Transferable[]) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = async (e: MessageEvent<BuildMsg | ExaggerateMsg>) => {
  try {
    const msg = e.data;
    if (msg.type === "build") {
      const t0 = performance.now();
      const raw = await gunzipMaybe(msg.bin);
      const land = msg.mask ? await gunzipMaybe(msg.mask) : null;
      const q = decodeDeltaPlanar(raw, msg.width);
      const heights = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) heights[i] = q[i] === 0 ? NaN : (q[i] - 1) * msg.stepM;
      dequantize(heights, msg.width, msg.height, msg.stepM);
      const t1 = performance.now();

      const cavity = cavityShade(heights, msg.width, msg.height, msg.cellSizeM);
      const g: Grid = { w: msg.width, h: msg.height, cell: msg.cellSizeM, stride: msg.stride, heights, land, cavity };
      grids.set(msg.key, g);
      const surface = surfaceTexture(g, msg.exaggeration);
      const t2 = performance.now();

      const m = meshFrom(g, msg.exaggeration);
      const heightsCopy = heights.slice();
      const out: BuiltMsg = {
        type: "built",
        key: msg.key,
        ...m,
        surface,
        heightsM: heightsCopy,
        ms: { decode: t1 - t0, surface: t2 - t1, mesh: performance.now() - t2 },
      };
      post(out, [m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.index.buffer, surface.buffer, heightsCopy.buffer]);
    } else {
      const g = grids.get(msg.key);
      if (!g) return;
      const surface = surfaceTexture(g, msg.exaggeration);
      const { positions, normals } = meshFrom(g, msg.exaggeration, false);
      const out: ExaggeratedMsg = { type: "exaggerated", key: msg.key, positions, normals, surface };
      post(out, [positions.buffer, normals.buffer, surface.buffer]);
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) }, []);
  }
};

/**
 * Des-cuantización restringida: cada altura guardada solo dice "el valor real está
 * en [h − paso/2, h + paso/2]". Se busca la superficie más suave compatible con
 * esos intervalos (promedio 3×3 iterado y recortado al intervalo de cada muestra).
 * En zonas planas elimina el aterrazado del paso de 0,5 m; en pendientes fuertes el
 * intervalo es angosto frente a la variación real y el detalle queda intacto.
 * Nunca se sale del rango que el dato permite.
 */
function dequantize(hs: Float32Array, w: number, h: number, step: number, iterations = 8) {
  const lo = new Float32Array(hs.length);
  const hi = new Float32Array(hs.length);
  for (let i = 0; i < hs.length; i++) {
    lo[i] = hs[i] - step / 2;
    hi[i] = hs[i] + step / 2;
  }
  const tmp = new Float32Array(hs.length);
  for (let it = 0; it < iterations; it++) {
    // Promedio horizontal de 3 (ignora huecos) …
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = hs[r + xx];
          if (v === v) (s += v), n++;
        }
        tmp[r + x] = n ? s / n : NaN;
      }
    }
    // … luego vertical de 3, y recorte al intervalo de cada muestra.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (hs[i] !== hs[i]) continue; // sin dato
        let s = 0;
        let n = 0;
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
}

// ─── Textura de superficie ─────────────────────────────────
function surfaceTexture(g: Grid, k: number): Uint8Array {
  const { w, h, cell, heights, land, cavity } = g;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z0 = heights[i];
      const [nx, , nz] = normalAt(heights, w, h, x, y, cell, k);
      out[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = cavity[i];
      out[i * 4 + 3] = Number.isNaN(z0) ? 0 : land && land[i] === 0 ? 128 : 255;
    }
  }
  return out;
}

/** Normal por diferencias centrales (unilaterales en bordes o junto a huecos). */
function normalAt(hs: Float32Array, w: number, h: number, x: number, y: number, step: number, k: number): [number, number, number] {
  const at = (xx: number, yy: number) => hs[yy * w + xx];
  const c = at(x, y);
  const self0 = Number.isNaN(c) ? 0 : c;
  const l = x > 0 ? at(x - 1, y) : NaN;
  const r = x < w - 1 ? at(x + 1, y) : NaN;
  const u = y > 0 ? at(x, y - 1) : NaN;
  const d = y < h - 1 ? at(x, y + 1) : NaN;
  const nL = Number.isNaN(l) ? 0 : 1;
  const nR = Number.isNaN(r) ? 0 : 1;
  const nU = Number.isNaN(u) ? 0 : 1;
  const nD = Number.isNaN(d) ? 0 : 1;
  const dx = ((nR ? r : self0) - (nL ? l : self0)) / (((nL + nR) || 1) * step);
  const dz = ((nD ? d : self0) - (nU ? u : self0)) / (((nU + nD) || 1) * step);
  const nx = -dx * k;
  const nz = -dz * k;
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}

/**
 * Sombreado de cavidades: cuánto está cada punto por debajo del promedio de su
 * entorno, a tres escalas (≈ 8, 24 y 64 m a 4 m de grilla). Promedios con tablas
 * de sumas acumuladas (O(n)). Es una aproximación visual de la oclusión ambiental
 * derivada del relieve real; no agrega ni inventa formas.
 */
function cavityShade(hs: Float32Array, w: number, h: number, cell: number): Uint8Array {
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1));
  const cnt = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    let rc = 0;
    for (let x = 0; x < w; x++) {
      const v = hs[y * w + x];
      if (!Number.isNaN(v)) (rs += v), rc++;
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + rs;
      cnt[(y + 1) * W1 + x + 1] = cnt[y * W1 + x + 1] + rc;
    }
  }
  const radiiM = [8, 24, 64];
  const depthM = [1.5, 4, 10]; // profundidad que se considera "muy encajonado" a cada escala
  const weight = [0.35, 0.35, 0.3];
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = hs[i];
      if (Number.isNaN(v)) {
        out[i] = 255;
        continue;
      }
      let occ = 0;
      for (let s = 0; s < 3; s++) {
        const r = Math.max(1, Math.round(radiiM[s] / cell));
        const x0 = Math.max(0, x - r);
        const x1 = Math.min(w, x + r + 1);
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h, y + r + 1);
        const S = sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0];
        const C = cnt[y1 * W1 + x1] - cnt[y0 * W1 + x1] - cnt[y1 * W1 + x0] + cnt[y0 * W1 + x0];
        const below = S / C - v; // > 0: el entorno está más alto → cavidad
        occ += weight[s] * Math.min(1, Math.max(0, below / depthM[s]));
      }
      out[i] = Math.round((1 - 0.55 * occ) * 255);
    }
  }
  return out;
}

// ─── Malla submuestreada ───────────────────────────────────
function meshFrom(g: Grid, k: number, withTopology = true) {
  const { w, h, cell, stride, heights } = g;
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const halfW = ((w - 1) * cell) / 2;
  const halfD = ((h - 1) * cell) / 2;
  const n = mw * mh;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const uvs = new Float32Array(withTopology ? n * 2 : 0);
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      const j = my * mw + mx;
      const x = mx * stride;
      const y = my * stride;
      const v = heights[y * w + x];
      positions[j * 3] = x * cell - halfW;
      positions[j * 3 + 1] = Number.isNaN(v) ? 0 : v * k;
      positions[j * 3 + 2] = y * cell - halfD;
      // Normal "de vértice" a la resolución de la malla (modo Antes).
      const nrm = normalAtStride(heights, w, h, x, y, stride, cell, k);
      normals[j * 3] = nrm[0];
      normals[j * 3 + 1] = nrm[1];
      normals[j * 3 + 2] = nrm[2];
      if (withTopology) {
        uvs[j * 2] = (x + 0.5) / w;
        uvs[j * 2 + 1] = (y + 0.5) / h;
      }
    }
  }
  let index = new Uint32Array(0);
  if (withTopology) {
    index = new Uint32Array((mw - 1) * (mh - 1) * 6);
    let t = 0;
    for (let y = 0; y < mh - 1; y++) {
      for (let x = 0; x < mw - 1; x++) {
        const a = x + mw * y;
        const b = x + mw * (y + 1);
        const c = x + 1 + mw * (y + 1);
        const d = x + 1 + mw * y;
        index[t++] = a;
        index[t++] = b;
        index[t++] = d;
        index[t++] = b;
        index[t++] = c;
        index[t++] = d;
      }
    }
  }
  return { positions, normals, uvs, index, mesh: { width: mw, height: mh } };
}

/** Normal usando solo las muestras de la malla (separadas `stride`): lo que se vería sin la textura. */
function normalAtStride(hs: Float32Array, w: number, h: number, x: number, y: number, s: number, cell: number, k: number) {
  const at = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? NaN : hs[yy * w + xx]);
  const c = at(x, y);
  const self0 = Number.isNaN(c) ? 0 : c;
  const l = at(x - s, y);
  const r = at(x + s, y);
  const u = at(x, y - s);
  const d = at(x, y + s);
  const nL = Number.isNaN(l) ? 0 : 1;
  const nR = Number.isNaN(r) ? 0 : 1;
  const nU = Number.isNaN(u) ? 0 : 1;
  const nD = Number.isNaN(d) ? 0 : 1;
  const dx = ((nR ? r : self0) - (nL ? l : self0)) / (((nL + nR) || 1) * s * cell);
  const dz = ((nD ? d : self0) - (nU ? u : self0)) / (((nU + nD) || 1) * s * cell);
  const nx = -dx * k;
  const nz = -dz * k;
  const len = Math.hypot(nx, 1, nz);
  return [nx / len, 1 / len, nz / len];
}

// ─── Decodificación ────────────────────────────────────────
async function gunzipMaybe(buf: ArrayBuffer): Promise<Uint8Array> {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8; // el servidor ya lo descomprimió
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
