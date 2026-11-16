import * as THREE from 'three';
import { CAM_H, IMG, project, ray } from './camara';
import { buildIslandMaps, type IslandTerrain } from './terrain-maps';
import { styleUniforms, stylizedMaterial } from './snow/shaders';

/**
 * Loma nevada GENERADA (reconstrucción artística, no relieve medido ni estimado por IA): un heightfield 3D de 16 × 16 m
 * (grilla de 5 cm) con el mismo material de nieve y roca y el mismo horneado de mapas que las islas del laboratorio
 * (terrain-maps.ts = penguin-lab/src/island/island-maps.ts). Al ser geometría de verdad, se extiende más allá del
 * cuadro (sin bordes al mover la cámara) y la sombra del pingüino cae sobre ella en tiempo real.
 *
 * Cómo se ajusta a la referencia (solo con la capa 07 pintada, sin Depth Anything):
 *  - silueta: la primera fila de terreno (sin pasto) de cada columna de la capa 07; la cresta se pone a la distancia
 *    del pingüino (10,3 m, ±1 m a los lados) con la altura que la hace coincidir con esa fila desde la cámara;
 *  - detrás de la cresta el terreno baja al mar en 3,2 m (queda oculto por la cresta); delante, pendiente suave con
 *    ondulaciones de ruido (nunca más alta que la cresta: la silueta no cambia);
 *  - rocas: donde la capa pintó roca (máscara proyectada desde la cámara) el terreno sube en bloques redondeados (≤ 30 cm)
 *    y el material pasa a roca; el resto lo decide el material por pendiente, como en el visor.
 */

/** Distancia (m) de la cresta frente a la cámara, la del pingüino (0,95 m = 162 px). */
export const RIDGE_M = 10.3;
const N = 321, HALF = 8, CELL = (HALF * 2) / (N - 1);
/** El centro de la grilla está a CENTER_M frente a la cámara (cubre de 3 a 19 m). */
const CENTER_M = 11;
const SEA_Y = 0;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function valueNoise(seed: number) {
  const h = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    return (h(xi, yi) * (1 - fx) + h(xi + 1, yi) * fx) * (1 - fy) + (h(xi, yi + 1) * (1 - fx) + h(xi + 1, yi + 1) * fx) * fy;
  };
}

/** Máscaras de la capa 07 (base-mascaras.webp): R = roca, G = pasto, B = cobertura; filas maskY0 … 940. */
export interface LayerMasks { data: Uint8ClampedArray; width: number; height: number; y0: number }

export class HeroTerrain implements IslandTerrain {
  readonly n = N; readonly half = HALF; readonly cell = CELL; readonly seaY = SEA_Y;
  readonly heights = new Float32Array(N * N);
  /** Roca (R) y pasto (G) proyectados desde la cámara sobre la grilla (para el material). */
  readonly masks = new Uint8Array(N * N * 4);
  readonly silhouette: Float32Array;

  constructor(m: LayerMasks) {
    const at = (x: number, y: number, k: number) => m.data[(clamp(Math.round(y) - m.y0, 0, m.height - 1) * m.width + clamp(Math.round(x), 0, m.width - 1)) * 4 + k];
    // ── silueta por columna (sin las matas de pasto que sobresalen) ─────────────────────────────────────
    const raw = new Float32Array(IMG.w);
    for (let x = 0; x < IMG.w; x++) { let y = m.y0; while (y < IMG.h - 1 && !(at(x, y, 2) > 128 && at(x, y, 1) < 90)) y++; raw[x] = y; }
    // Cierre morfológico (en altura) de ±18 px: donde el pasto tapa la cresta, la primera fila sin pasto caía muy abajo y
    // dejaba un surco que bajaba por toda la ladera. Después, suavizado de ±4 px.
    const roll = (a: Float32Array, r: number, f: (p: number, q: number) => number) => a.map((_, x) => { let v = a[x]; for (let d = -r; d <= r; d++) v = f(v, a[clamp(x + d, 0, IMG.w - 1)]); return v; });
    const closed = roll(roll(raw, 18, Math.min), 18, Math.max);
    this.silhouette = closed.map((_, x) => { let s = 0; for (let d = -4; d <= 4; d++) s += closed[clamp(x + d, 0, IMG.w - 1)]; return s / 9; });
    const sil = (x: number) => { const xi = clamp(x, 0, IMG.w - 1), i = Math.floor(xi), f = xi - i; return this.silhouette[i] * (1 - f) + this.silhouette[Math.min(IMG.w - 1, i + 1)] * f; };
    const n1 = valueNoise(3), n2 = valueNoise(11), n3 = valueNoise(29);
    // distancia de la cresta: la del pingüino en el centro, ±1 m lejos de él (lomas laterales más cerca o más lejos)
    const ridgeZ = (x: number) => RIDGE_M + (n3(x / 260, 0.5) - 0.5) * 2 * smooth(120, 420, Math.abs(x - 822));
    const ridgeH = (x: number) => { const Zr = ridgeZ(x), r = ray(x, sil(x)); return CAM_H + (Zr * r[1]) / -r[2]; };
    // la ladera de adelante sigue una cresta suavizada a lo ancho (±70 px): las formas de la silueta no bajan como surcos
    const ridgeTab = Float32Array.from({ length: IMG.w + 400 }, (_, k) => ridgeH(k - 200));
    const ridgeSmooth = (x: number) => { let s = 0, n = 0; for (let d = -70; d <= 70; d += 5) { s += ridgeTab[clamp(Math.round(x + d) + 200, 0, ridgeTab.length - 1)]; n++; } return s / n; };

    // ── alturas: cresta + caída hacia el mar (atrás) + pendiente suave con ondulaciones (adelante) ──────────
    const H0 = new Float32Array(N * N), ridge = new Float32Array(N * N), front = new Float32Array(N * N);
    const rock = new Float32Array(N * N), grass = new Float32Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, X = -HALF + c * CELL, zl = -HALF + r * CELL, Z = CENTER_M - zl;
      const x = project([X, 2 - CAM_H, -Z])[0], Zr = ridgeZ(x), Hr = ridgeH(x), d = Z - Zr;
      let h: number;
      if (d >= 0) h = Hr - (Hr + 0.8) * smooth(0, 3.2, d);
      else {
        const u = -d;
        h = Hr + (ridgeSmooth(x) - Hr) * smooth(0, 1.6, u) - (0.06 * u + 0.05 * u * u);
        h += ((n1(X * 0.55, Z * 0.55) - 0.5) * 0.45 + (n2(X * 1.6, Z * 1.6) - 0.5) * 0.14) * smooth(0.3, 1.8, u);
        h = Math.min(h, Hr);
      }
      H0[i] = h; ridge[i] = Hr; front[i] = d < 0 ? smooth(0.25, 1.1, -d) : 0;
      // máscaras de la capa 07 en el píxel donde la cámara ve este punto
      const [px, py] = project([X, h - CAM_H, -Z]);
      if (d < 0.2 && py >= m.y0 && py < IMG.h && px >= -2 && px < IMG.w + 2) { rock[i] = at(px, py, 0) / 255; grass[i] = at(px, py, 1) / 255; }
    }
    // roca: campo suavizado (≈ 45 cm) → bloques redondeados de hasta 30 cm, solo adelante de la cresta
    const blur = (a: Float32Array, rad: number) => {
      const t = new Float32Array(a.length), o = new Float32Array(a.length);
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { let s = 0; for (let d = -rad; d <= rad; d++) s += a[r * N + clamp(c + d, 0, N - 1)]; t[r * N + c] = s / (2 * rad + 1); }
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { let s = 0; for (let d = -rad; d <= rad; d++) s += t[clamp(r + d, 0, N - 1) * N + c]; o[r * N + c] = s / (2 * rad + 1); }
      return o;
    };
    const rockS = blur(blur(rock, 5), 4);
    for (let i = 0; i < N * N; i++) {
      const bump = 0.3 * Math.pow(smooth(0.12, 0.65, rockS[i]), 0.8) * front[i];
      this.heights[i] = Math.min(H0[i] + bump, ridge[i]);
      this.masks[i * 4] = Math.round(clamp(rock[i], 0, 1) * 255);
      this.masks[i * 4 + 1] = Math.round(clamp(grass[i], 0, 1) * 255);
      this.masks[i * 4 + 3] = 255;
    }
  }
  /** Altura bilineal (coordenadas locales: x, z en ±half). */
  sample(x: number, z: number) {
    const gx = clamp((x + HALF) / CELL, 0, N - 1), gz = clamp((z + HALF) / CELL, 0, N - 1);
    const ix = Math.min(Math.floor(gx), N - 2), iz = Math.min(Math.floor(gz), N - 2), fx = gx - ix, fz = gz - iz, i = iz * N + ix, h = this.heights;
    return (h[i] * (1 - fx) + h[i + 1] * fx) * (1 - fz) + (h[i + N] * (1 - fx) + h[i + N + 1] * fx) * fz;
  }
  ice() { return 0; }
  /** Punto de mundo donde el rayo del píxel (x, y) de la referencia toca el terreno (o null). */
  raycast(x: number, y: number): THREE.Vector3 | null {
    const r = ray(x, y);
    let prev = 0;
    for (let t = 1; t < 40; t += 0.01) {
      const wx = r[0] * t, wy = CAM_H + r[1] * t, wz = r[2] * t, zl = CENTER_M + wz;
      if (Math.abs(wx) > HALF || Math.abs(zl) > HALF) { prev = t; continue; }
      if (wy <= this.sample(wx, zl)) {
        // refinamiento por bisección entre el paso anterior y este
        let a = prev, b = t;
        for (let k = 0; k < 20; k++) { const m = (a + b) / 2, my = CAM_H + r[1] * m, mz = CENTER_M + r[2] * m; if (my <= this.sample(r[0] * m, mz)) b = m; else a = m; }
        return new THREE.Vector3(r[0] * b, CAM_H + r[1] * b, r[2] * b);
      }
      prev = t;
    }
    return null;
  }
}

export function loadMasks(url: string, y0: number) {
  return new Promise<LayerMasks>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height);
      resolve({ data: d.data, width: d.width, height: d.height, y0 });
    };
    img.onerror = reject; img.src = url;
  });
}

/** Malla, mapas y material de la loma (como IslandGround del laboratorio, sin huellas ni agua propia). */
export function createTerrain(masks: LayerMasks, sun: THREE.Vector3) {
  const t0 = performance.now();
  const t = new HeroTerrain(masks);
  const tTerrain = performance.now() - t0;
  const maps = buildIslandMaps(t, [sun.x, sun.y, sun.z]);
  const tMaps = performance.now() - t0 - tTerrain;
  const tex = (data: Uint8Array, size: number) => {
    const x = new THREE.DataTexture(data, size, size);
    x.generateMipmaps = true; x.minFilter = THREE.LinearMipmapLinearFilter; x.magFilter = THREE.LinearFilter; x.needsUpdate = true;
    return x;
  };
  const surface = tex(maps.surface, N), light = tex(maps.light, maps.lightSize), maskTex = tex(t.masks, N);
  // texCellM 8 → sesgo de mip log2(16 / 8) = 1 en las normales de la nieve: suavizado de ~10 cm (escala de la loma)
  const u = styleUniforms({ surface, light }, { halfSize: [1000, 1000], seaY: SEA_Y, texCellM: 8 });
  // Escala de un pingüino (como las islas del laboratorio): sin desplazamiento kilométrico ni rampa costera.
  u.uSnowDisp.value.x = 0;
  u.uCoastRamp.value.w = 0;
  u.uSeaBedDepth.value.set(0.25, 1.2);
  u.uSeaBed.value.set(0.06, 0.085, 0.09);
  u.uSeaBedMid.value.set(0.03, 0.05, 0.06);
  u.uDetailFade.value.set(40, 120);
  // nieve algo más gris azulada que la del visor: con la luz baja de la referencia quedaba blanca y plana
  u.uSnow.value.set(0.70, 0.76, 0.84);
  // roca algo más clara que en el visor (luminancia lineal 0,17 → 0,22): en la referencia los bloques son gris medio
  u.uRockTone.value.x = 0.22;
  const extra = { uHeroMask: { value: maskTex }, uGrass: { value: new THREE.Color('#9c7b45') } };

  // ── malla: 1 de cada 2 puntos de la grilla (10 cm) ────────────────────────────────────────────────────────
  const S = 2, m = (N - 1) / S + 1, pos = new Float32Array(m * m * 3), nor = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2);
  const h = t.heights, H = (c: number, r: number) => h[clamp(r, 0, N - 1) * N + clamp(c, 0, N - 1)];
  for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
    const v = r * m + c, fc = c * S, fr = r * S;
    pos.set([-HALF + fc * CELL, H(fc, fr), -HALF + fr * CELL], v * 3);
    const nx = -(H(fc + 1, fr) - H(fc - 1, fr)) / (2 * CELL), nz = -(H(fc, fr + 1) - H(fc, fr - 1)) / (2 * CELL), len = Math.hypot(nx, 1, nz);
    nor.set([nx / len, 1 / len, nz / len], v * 3);
    uv.set([(fc + 0.5) / N, (fr + 0.5) / N], v * 2);
  }
  const idx: number[] = [], under = SEA_Y - 0.05;
  for (let r = 0; r < m - 1; r++) for (let c = 0; c < m - 1; c++) {
    const a = r * m + c, b = a + 1, cc = a + m, d = cc + 1;
    if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[cc * 3 + 1], pos[d * 3 + 1]) < under) continue;
    if ((r + c) & 1) idx.push(a, cc, b, b, cc, d); else idx.push(a, cc, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('surfUv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const material = stylizedMaterial(u, { variant: 'n', exactCoast: true });
  const compile = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (s, renderer) => {
    compile(s, renderer);
    Object.assign(s.uniforms, extra);
    const must = (from: string, to: string) => { if (!s.fragmentShader.includes(from)) throw new Error('Material de nieve: no se encontró ' + from); s.fragmentShader = s.fragmentShader.replace(from, to); };
    must('#include <common>', '#include <common>\nuniform sampler2D uHeroMask; uniform vec3 uGrass;');
    must('vec4 surf = texture2D(uSurface, vSurfUv);', 'vec4 heroM = texture2D(uHeroMask, vSurfUv);\nvec4 surf = texture2D(uSurface, vSurfUv);');
    // roca donde la capa 07 pintó roca (además de la roca por pendiente del material)
    must('float rockT = smoothstep(0.32 - wEdge, 0.32 + wEdge, tEdge);', 'float rockT = smoothstep(0.32 - wEdge, 0.32 + wEdge, tEdge);\nrockT = max(rockT, smoothstep(0.35, 0.75, heroM.r) * smoothstep(0.004, 0.04, steep)); // con nieve en las caras planas (bloques nevados)');
    // tinte suave bajo las matas de pasto (los recortes de pasto van en grass.ts)
    must('diffuseColor.rgb = mix(land, sea, isSea);', 'diffuseColor.rgb = mix(land, sea, isSea);\nfloat grassK = 0.35 * smoothstep(0.25, 0.8, heroM.g);\ndiffuseColor.rgb = mix(diffuseColor.rgb, uGrass * (0.7 + 0.6 * texture2D(uNoise, vWorld.xz * 2.3).g), grassK);\ngSnowK *= 1.0 - grassK;');
    // como en las islas: orilla a escala de la loma y sin brillo de nieve bajo el agua
    s.fragmentShader = s.fragmentShader
      .replace('smoothstep(-0.8, 0.1, vWorld.y - uSeaY)', 'smoothstep(-0.07, 0.01, vWorld.y - uSeaY)')
      .replace('gSnowK = (1.0 - rockT)', 'gSnowK = step(uSeaY, vWorld.y) * (1.0 - rockT)');
  };
  material.customProgramCacheKey = () => 'antaris-hero-loma-generada-v1';
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'loma'; mesh.receiveShadow = true;
  mesh.position.z = -CENTER_M;

  return {
    terrain: t, mesh, uniforms: u, triangles: idx.length / 3,
    timings: { terrenoMs: Math.round(tTerrain), mapasMs: Math.round(tMaps), totalMs: Math.round(performance.now() - t0) },
    /** Punto de mundo del terreno que se ve en el píxel (x, y) de la referencia. */
    groundAt(x: number, y: number) {
      return t.raycast(x, y) ?? new THREE.Vector3(...((r) => [r[0] * RIDGE_M / -r[2], CAM_H + r[1] * RIDGE_M / -r[2], -RIDGE_M] as [number, number, number])(ray(x, y)));
    },
    dispose() { geo.dispose(); material.dispose(); surface.dispose(); light.dispose(); maskTex.dispose(); },
  };
}
