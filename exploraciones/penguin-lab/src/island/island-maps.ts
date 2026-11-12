import type { IslandTerrain } from './island-terrain.ts';

/**
 * Texturas que el material de nieve de Antaris espera, calculadas para una isla sintética
 * (módulo puro, sin Three.js). Mismos canales que en el visor:
 *   surface (n × n, la grilla fina): R, G = normal xz · B = cavidad (aquí solo huellas) ·
 *            A = distancia con signo a la costa (m · 8 + 128, ±16 m).
 *   light   (size × size):           R = sombra del sol horneada · G = cercanía a la costa ·
 *            B = curvatura con signo · A = 255 − hielo (canal libre en el visor; aquí, la máscara de hielo).
 * La sombra del relieve va horneada: el terreno no se dibuja en el mapa de sombras en tiempo real.
 */
export interface IslandMaps {
  surface: Uint8Array;
  light: Uint8Array;
  lightSize: number;
  /** Distancia con signo a la costa en la grilla fina (m, + tierra). */
  sdf: Float32Array;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Transformada de distancia euclídea exacta (Felzenszwalb y Huttenlocher), en celdas al cuadrado. */
function edt(feature: Uint8Array, n: number) {
  const INF = 1e20, out = new Float32Array(n * n), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = () => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
  };
  for (let c = 0; c < n; c++) { for (let r = 0; r < n; r++) f[r] = feature[r * n + c] ? 0 : INF; pass(); for (let r = 0; r < n; r++) out[r * n + c] = d[r]; }
  for (let r = 0; r < n; r++) { const o = r * n; for (let c = 0; c < n; c++) f[c] = out[o + c]; pass(); for (let c = 0; c < n; c++) out[o + c] = d[c]; }
  return out;
}

/**
 * Distancia con signo a la costa (m, + tierra) en la grilla fina. Se calcula a media resolución
 * (5,5 cm: escalones muy por debajo del píxel) y se interpola: 4 veces menos trabajo.
 */
export function coastDistance(t: IslandTerrain) {
  const n = t.n, m = (n - 1) / 2 + 1, land = new Uint8Array(m * m), sea = new Uint8Array(m * m);
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) { const isLand = t.heights[2 * r * n + 2 * c] > t.seaY; land[r * m + c] = +isLand; sea[r * m + c] = +!isLand; }
  const toLand = edt(land, m), toSea = edt(sea, m), coarse = new Float32Array(m * m), step = t.cell * 2;
  for (let i = 0; i < m * m; i++) coarse[i] = land[i] ? (Math.sqrt(toSea[i]) - 0.5) * step : -(Math.sqrt(toLand[i]) - 0.5) * step;
  const sdf = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const r0 = r >> 1, r1 = Math.min(m - 1, r0 + (r & 1)), fr = (r & 1) * 0.5;
    for (let c = 0; c < n; c++) {
      const c0 = c >> 1, c1 = Math.min(m - 1, c0 + (c & 1)), fc = (c & 1) * 0.5;
      sdf[r * n + c] = (coarse[r0 * m + c0] * (1 - fc) + coarse[r0 * m + c1] * fc) * (1 - fr) + (coarse[r1 * m + c0] * (1 - fc) + coarse[r1 * m + c1] * fc) * fr;
    }
  }
  return sdf;
}

/** Escribe normal y cavidad de un texel de la grilla fina con las alturas deformadas por las huellas. */
export function writeSurfaceTexel(t: IslandTerrain, surface: Uint8Array, depths: Float32Array | null, maxDepth: number, col: number, row: number) {
  const n = t.n, h = t.heights, i = row * n + col;
  const H = (c: number, r: number) => { const j = clamp(r, 0, n - 1) * n + clamp(c, 0, n - 1); return depths ? h[j] - depths[j] : h[j]; };
  const nx = -(H(col + 1, row) - H(col - 1, row)) / (2 * t.cell), nz = -(H(col, row + 1) - H(col, row - 1)) / (2 * t.cell), len = Math.hypot(nx, 1, nz), o = i * 4;
  surface[o] = Math.round((nx / len * 0.5 + 0.5) * 255);
  surface[o + 1] = Math.round((nz / len * 0.5 + 0.5) * 255);
  surface[o + 2] = depths ? Math.round(255 * (1 - Math.min(0.4, (depths[i] / maxDepth) * 0.4))) : 255;
}

/** Posición de mundo del centro del texel j de una textura de `size` texeles alineada con la grilla fina. */
export function lightTexelWorld(t: IslandTerrain, size: number, j: number) { return ((j + 0.5) / size * t.n - 0.5) * t.cell - t.half; }

/** Lado de la textura de luz: ~14,5 cm por texel, nunca menos de 256 (sombra, orilla, curvatura y hielo). */
export function lightSizeFor(t: IslandTerrain) { return Math.max(256, Math.round((t.half * 2) / 0.145 / 32) * 32); }

export function buildIslandMaps(t: IslandTerrain, sun: [number, number, number], lightSize = lightSizeFor(t)): IslandMaps {
  const n = t.n, surface = new Uint8Array(n * n * 4), sdf = coastDistance(t), h = t.heights, k = 1 / (2 * t.cell);
  // Mismo cálculo que writeSurfaceTexel, sin funciones por texel (≈ 1 millón de texeles).
  for (let row = 0; row < n; row++) {
    const up = Math.max(0, row - 1) * n, down = Math.min(n - 1, row + 1) * n;
    for (let col = 0; col < n; col++) {
      const i = row * n + col, nx = -(h[row * n + Math.min(n - 1, col + 1)] - h[row * n + Math.max(0, col - 1)]) * k, nz = -(h[down + col] - h[up + col]) * k;
      const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz), o = i * 4;
      surface[o] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      surface[o + 1] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      surface[o + 2] = 255;
      surface[o + 3] = Math.round(clamp(sdf[i] * 8 + 128, 0, 255));
    }
  }
  const m = lightSize, light = new Uint8Array(m * m * 4), L = Math.hypot(...sun), lx = sun[0] / L, ly = sun[1] / L, lz = sun[2] / L;
  const sdfAt = (x: number, z: number) => {
    const gx = clamp((x + t.half) / t.cell, 0, n - 1), gz = clamp((z + t.half) / t.cell, 0, n - 1), ix = Math.min(Math.floor(gx), n - 2), iz = Math.min(Math.floor(gz), n - 2), fx = gx - ix, fz = gz - iz, i = iz * n + ix;
    return (sdf[i] * (1 - fx) + sdf[i + 1] * fx) * (1 - fz) + (sdf[i + n] * (1 - fx) + sdf[i + n + 1] * fx) * fz;
  };
  const e = 0.22; // curvatura a escala de ~0,5 m: aristas y canaletas de la roca
  for (let row = 0; row < m; row++) {
    const z = lightTexelWorld(t, m, row);
    for (let col = 0; col < m; col++) {
      const x = lightTexelWorld(t, m, col), h = Math.max(t.sample(x, z), t.seaY), o = (row * m + col) * 4;
      // Sombra suave del relieve hacia el sol (marcha sobre el campo de alturas, penumbra por distancia).
      let lit = 1;
      for (let s = 0.08; s < 18; s += Math.max(0.05, s * 0.07)) {
        const px = x + lx * s, pz = z + lz * s;
        if (Math.abs(px) > t.half || Math.abs(pz) > t.half) break;
        lit = Math.min(lit, (h + 0.02 + ly * s - t.sample(px, pz)) * 9 / s);
        if (lit <= 0) break;
      }
      light[o] = Math.round(smoothstep(0, 1, lit) * 255);
      light[o + 1] = Math.round((1 - smoothstep(0, 6, Math.abs(sdfAt(x, z)))) * 255);
      const lap = (t.sample(x + e, z) + t.sample(x - e, z) + t.sample(x, z + e) + t.sample(x, z - e) - 4 * t.sample(x, z)) / (e * e);
      light[o + 2] = Math.round((clamp(lap * 0.09, -1, 1) * 0.5 + 0.5) * 255);
      light[o + 3] = Math.round((1 - t.ice(x, z)) * 255);
    }
  }
  return { surface, light, lightSize: m, sdf };
}
