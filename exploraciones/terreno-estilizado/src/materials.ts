import * as THREE from "three";

/**
 * Dos materiales sobre la misma geometría y las mismas texturas calculadas:
 *  - BASE: el sombreado de exploraciones/terreno-nitidez (modo "Después"), para medir el antes.
 *  - ESTILIZADO: interpretación artística (fase 1). Todo deriva del relieve REMA, la costa ADD
 *    y una sombra de sol fijo; el ruido procedural solo agrega variación visual.
 */

export const lin = (hex: string) => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

export interface SharedTextures {
  surface: THREE.DataTexture;
  light: THREE.DataTexture;
}

/**
 * Textura de ruido tileable (256², RG8) generada al cargar: 0 bytes de descarga.
 * R = ruido de valor suave, G = fbm de 3 octavas. Reemplaza el ruido procedural
 * calculado por píxel, que triplicaba el tiempo de GPU (medido: 6,3 → 20,7 ms).
 */
let noiseTex: THREE.DataTexture | null = null;
export function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 2);
  const lattice = (n: number, seed: number) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return g;
  };
  // Ruido de valor periódico con interpolación suave; `cells` celdas por lado.
  const value = (cells: number, seed: number) => {
    const g = lattice(cells, seed);
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells, fy = (y / N) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[((b % cells) * cells) + (a % cells)];
      out[y * N + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
    return out;
  };
  const v8 = value(8, 7);
  const v16 = value(16, 13), v32 = value(32, 29), v64 = value(64, 41);
  for (let i = 0; i < N * N; i++) {
    data[i * 2] = Math.round(v8[i] * 255);
    data[i * 2 + 1] = Math.round((0.55 * v16[i] + 0.3 * v32[i] + 0.15 * v64[i]) * 255);
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.generateMipmaps = true;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.colorSpace = THREE.NoColorSpace;
  noiseTex.needsUpdate = true;
  return noiseTex;
}
