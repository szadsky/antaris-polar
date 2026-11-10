import * as THREE from "three";

/**
 * Mapa de normales de detalle CORREGIDO (512², RGBA8, generado al cargar; 0 bytes de descarga).
 *
 * Diagnóstico (ver README, "Corrección de nieve y roca"): el mapa anterior (`detailTexture()`)
 * causaba las ondas de la nieve —una onda seno de amplitud 0,35 con dirección fija— y parte de
 * la roca arrugada —fbm crestado de 4 octavas con rasgos de hasta ~1,7 m—.
 *
 *   R,G = roca: 2 octavas suaves (sin crestas): formas grandes, sin alta frecuencia.
 *   B,A = nieve: ruido isótropo fino de muy baja amplitud (sin dirección ni ondas).
 */
let tex: THREE.DataTexture | null = null;

export function detailTextureCorrected() {
  if (tex) return tex;
  const N = 512;
  const value = (cells: number, seed: number) => {
    const g = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * cells;
        const fy = (y / N) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        let tx = fx - x0;
        let ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const at = (a: number, b: number) => g[(b % cells) * cells + (a % cells)];
        out[y * N + x] =
          (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      }
    }
    return out;
  };
  // Roca: formas grandes (4 y 8 celdas por mosaico → con mosaico de 60 m, rasgos de ~15 y ~8 m).
  const r4 = value(4, 101);
  const r8 = value(8, 103);
  const rock = new Float32Array(N * N);
  for (let i = 0; i < rock.length; i++) rock[i] = 0.7 * r4[i] + 0.3 * r8[i];
  // Nieve: grano isótropo (32 y 64 celdas → ~2 y ~1 m), sin ondas ni dirección.
  const s32 = value(32, 107);
  const s64 = value(64, 109);
  const snow = new Float32Array(N * N);
  for (let i = 0; i < snow.length; i++) snow[i] = 0.6 * s32[i] + 0.4 * s64[i];

  const data = new Uint8Array(N * N * 4);
  const normalInto = (h: Float32Array, strength: number, o: number) => {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const at = (xx: number, yy: number) => h[((yy + N) % N) * N + ((xx + N) % N)];
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * N + x) * 4 + o;
        data[i] = Math.round((-dx / len) * 127.5 + 127.5);
        data[i + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      }
    }
  };
  normalInto(rock, 60, 0); // formas grandes: gradiente bajo por píxel → factor alto para que se lean
  normalInto(snow, 14, 2);

  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace; // datos, no color
  tex.needsUpdate = true;
  return tex;
}
