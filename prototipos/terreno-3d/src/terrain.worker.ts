/**
 * Web Worker del terreno: todo el trabajo pesado fuera del hilo principal.
 *   1. Descomprime (gzip, si hace falta) y decodifica delta-planar-v1.
 *   2. Convierte a alturas en metros (NaN = sin dato).
 *   3. Arma posiciones, índices, normales (diferencias centrales) y colores.
 * Los arreglos vuelven por transferencia (sin copiar).
 */

export interface BuildRequest {
  type: "build";
  key: string;
  bin: ArrayBuffer;
  mask: ArrayBuffer | null;
  encoding?: string;
  width: number;
  height: number;
  cellSizeM: number;
  minM: number;
  maxM: number;
  exaggeration: number;
}

export interface ExaggerateRequest {
  type: "exaggerate";
  key: string;
  exaggeration: number;
}

export interface Built {
  type: "built";
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  valid: Float32Array;
  index: Uint32Array;
  heightsM: Float32Array;
  ms: { decode: number; mesh: number };
}

export interface Exaggerated {
  type: "exaggerated";
  key: string;
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
}

interface Grid {
  w: number;
  h: number;
  cell: number;
  heights: Float32Array;
  land: Uint8Array | null;
}

const grids = new Map<string, Grid>();

self.onmessage = async (e: MessageEvent<BuildRequest | ExaggerateRequest>) => {
  try {
    const msg = e.data;
    if (msg.type === "build") {
      const t0 = performance.now();
      const bin = await maybeGunzip(msg.bin);
      const mask = msg.mask ? await maybeGunzip(msg.mask) : null;
      const q =
        msg.encoding === "delta-planar-v1" ? decodeDeltaPlanar(bin, msg.width) : new Uint16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2);
      const span = msg.maxM - msg.minM;
      const heights = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) heights[i] = q[i] === 0 ? NaN : ((q[i] - 1) / 65534) * span;
      const t1 = performance.now();

      const grid: Grid = { w: msg.width, h: msg.height, cell: msg.cellSizeM, heights, land: mask };
      grids.set(msg.key, grid);
      const { positions, normals, colors } = surface(grid, msg.exaggeration);
      const valid = new Float32Array(heights.length);
      for (let i = 0; i < heights.length; i++) valid[i] = Number.isNaN(heights[i]) ? 0 : 1;
      const index = buildIndex(grid.w, grid.h);
      const heightsCopy = heights.slice();
      const out: Built = {
        type: "built",
        key: msg.key,
        positions,
        normals,
        colors,
        valid,
        index,
        heightsM: heightsCopy,
        ms: { decode: t1 - t0, mesh: performance.now() - t1 },
      };
      (self as unknown as Worker).postMessage(out, [
        positions.buffer,
        normals.buffer,
        colors.buffer,
        valid.buffer,
        index.buffer,
        heightsCopy.buffer,
      ]);
    } else if (msg.type === "exaggerate") {
      const grid = grids.get(msg.key);
      if (!grid) return;
      const { positions, normals, colors } = surface(grid, msg.exaggeration);
      const out: Exaggerated = { type: "exaggerated", key: msg.key, positions, normals, colors };
      (self as unknown as Worker).postMessage(out, [positions.buffer, normals.buffer, colors.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

/** gzip empieza con 1f 8b. Si el servidor ya lo descomprimió (Content-Encoding), se usa tal cual. */
async function maybeGunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inverso de encodeDeltaPlanar (scripts/convert-rema.mjs). */
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

/** Mismo orden y sentido de triángulos que THREE.PlaneGeometry rotado -90° en X. */
function buildIndex(w: number, h: number): Uint32Array {
  const index = new Uint32Array((w - 1) * (h - 1) * 6);
  let k = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = x + w * y;
      const b = x + w * (y + 1);
      const c = x + 1 + w * (y + 1);
      const d = x + 1 + w * y;
      index[k++] = a;
      index[k++] = b;
      index[k++] = d;
      index[k++] = b;
      index[k++] = c;
      index[k++] = d;
    }
  }
  return index;
}

// Colores en espacio lineal (como los guarda THREE.Color con gestión de color activa).
const SNOW = srgbToLinear(0xee, 0xf3, 0xf6);
const ROCK = srgbToLinear(0x4a, 0x46, 0x43);
const SEA = srgbToLinear(0x1d, 0x3a, 0x4c);

/**
 * Posiciones (fila 0 hacia -Z), normales por diferencias centrales y colores:
 * mar según costa ADD (dato); nieve/roca según pendiente (estético, no es cobertura).
 */
function surface(g: Grid, k: number) {
  const { w, h, cell, heights, land } = g;
  const n = w * h;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const halfW = ((w - 1) * cell) / 2;
  const halfD = ((h - 1) * cell) / 2;
  const hy = (x: number, y: number) => {
    const v = heights[y * w + x];
    return Number.isNaN(v) ? NaN : v * k;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const z0 = hy(x, y);
      positions[i * 3] = x * cell - halfW;
      positions[i * 3 + 1] = Number.isNaN(z0) ? 0 : z0;
      positions[i * 3 + 2] = y * cell - halfD;

      // Diferencias centrales (unilaterales en los bordes o junto a huecos).
      const self0 = Number.isNaN(z0) ? 0 : z0;
      const l = x > 0 ? hy(x - 1, y) : NaN;
      const r = x < w - 1 ? hy(x + 1, y) : NaN;
      const u = y > 0 ? hy(x, y - 1) : NaN;
      const d = y < h - 1 ? hy(x, y + 1) : NaN;
      const L = Number.isNaN(l) ? self0 : l;
      const R = Number.isNaN(r) ? self0 : r;
      const U = Number.isNaN(u) ? self0 : u;
      const D = Number.isNaN(d) ? self0 : d;
      const dx = (R - L) / (((Number.isNaN(l) ? 0 : 1) + (Number.isNaN(r) ? 0 : 1)) * cell || cell);
      const dz = (D - U) / (((Number.isNaN(u) ? 0 : 1) + (Number.isNaN(d) ? 0 : 1)) * cell || cell);
      let nx = -dx;
      let ny = 1;
      let nz = -dz;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      normals[i * 3] = nx;
      normals[i * 3 + 1] = ny;
      normals[i * 3 + 2] = nz;

      let c: [number, number, number];
      if (land && land[i] === 0) c = SEA;
      else {
        const t = smoothstep(0.18, 0.42, 1 - ny);
        c = [SNOW[0] + (ROCK[0] - SNOW[0]) * t, SNOW[1] + (ROCK[1] - SNOW[1]) * t, SNOW[2] + (ROCK[2] - SNOW[2]) * t];
      }
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
  }
  return { positions, normals, colors };
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function srgbToLinear(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [f(r), f(g), f(b)];
}
