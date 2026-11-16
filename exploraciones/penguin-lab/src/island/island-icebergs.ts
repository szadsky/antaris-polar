import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { STYL_RAMP, SNOW_GLINTS, SUN_SHADOW_LIGHTS } from '../snow/snow-light';
import type { IslandTerrain } from './island-terrain';

/**
 * Icebergs del visor de bases (terreno-estilizado/src/icebergs.ts, 14/11/2026) alrededor de la isla del pingüino:
 * misma geometría simple y suave (20 lados, 9 anillos, ~280 triángulos, una forma propia por semilla), mismo material
 * con las propiedades de la nieve del terreno y la misma flotación, a escala de la isla. Ubicación fija por isla
 * (semilla de la isla). Reconstrucción artística decorativa: no son icebergs observados.
 */
export const BERG_FORMS = ['Tabular', 'Domo', 'Cuña', 'Pináculo'] as const;
const BERG_KINDS = [0, 1, 2, 0, 3, 1, 2, 0];
/** Escala de los icebergs del visor en la isla: el tabular del visor (~64 m) queda de ~3 m al lado de un pingüino de 1,25 m. */
export const BERG_SCALE = 1 / 22;

// Generador con semilla (mulberry32): la misma semilla da siempre la misma forma.
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function noise3(seed: number) {
  const h = (x: number, y: number, z: number) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37) * 43758.5453; return v - Math.floor(v); };
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dx: number, dy: number, dz: number) => h(xi + dx, yi + dy, zi + dz);
    return l(l(l(c(0, 0, 0), c(1, 0, 0), xf), l(c(0, 1, 0), c(1, 1, 0), xf), yf), l(l(c(0, 0, 1), c(1, 0, 1), xf), l(c(0, 1, 1), c(1, 1, 1), xf), yf), zf) * 2 - 1;
  };
}

/** Geometría del visor, sin cambios (metros del visor; la malla se escala con BERG_SCALE). */
export function icebergGeometry(kind: number, seed = kind + 1) {
  const rand = rng(seed * 9301 + kind * 49297 + 7), n3 = noise3(seed * 3.1 + kind);
  const segments = 20, positions: number[] = [], indices: number[] = [], colors: number[] = [];
  const base = [64, 46, 52, 40][kind] * (.85 + rand() * .3), aspect = [.62, .8, .7, .85][kind] + rand() * .18;
  const rx = base, rz = base * aspect, size = base / 55;
  const harm = Array.from({ length: 4 }, (_, i) => ({ k: i + 2, amp: .13 / Math.pow(i + 2, .7) * (.4 + rand()), ph: rand() * Math.PI * 2 }));
  const dents = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => ({ a: rand() * Math.PI * 2, w: .3 + rand() * .25, d: .08 + rand() * .1 }));
  const outline = (a: number) => { let r = 1; for (const h of harm) r += h.amp * Math.cos(h.k * a + h.ph); for (const d of dents) { const da = Math.atan2(Math.sin(a - d.a), Math.cos(a - d.a)); r -= d.d * Math.exp(-(da * da) / (d.w * d.w)); } return Math.max(.55, r); };
  const tiltA = rand() * Math.PI * 2, tilt = (rand() - .5) * .25;
  const lumps = Array.from({ length: 2 }, (_, i) => ({ x: (rand() - .5) * .8, z: (rand() - .5) * .8,
    h: kind === 3 ? (i === 0 ? 28 + rand() * 12 : 12 + rand() * 10) : (i === 0 ? 14 + rand() * 9 : 6 + rand() * 7), s: kind === 3 ? 5 + rand() * 4 : 2.5 + rand() * 2 }));
  const H0 = [15 + rand() * 8, 6, 5, 5][kind], wedge = 26 + rand() * 10;
  const top = (nx: number, nz: number, r: number) => {
    const along = nx * Math.cos(tiltA) + nz * Math.sin(tiltA);
    let y: number;
    if (kind === 0) y = H0 + along * tilt * 30 - 2.5 * r * r;
    else if (kind === 2) y = H0 + wedge * Math.min(1, Math.max(0, (along + 1.05) / 2.1)) ** 1.3;
    else { y = H0; for (const l of lumps) y += l.h * Math.exp(-((nx - l.x) ** 2 + (nz - l.z) ** 2) * l.s); }
    return y + 1.5 * n3(nx * 1.4 + seed, .7, nz * 1.4);
  };
  const slope = [.14 + rand() * .12, .3 + rand() * .15, .2 + rand() * .12, .32 + rand() * .14][kind], rTop = 1 - slope, bend = .6 + rand() * 1.1;
  const wallAt = (f: number) => 1 - slope * Math.pow(f, bend);
  type Ring = { r: number; y: number } | { f: number } | { t: number };
  const rings: Ring[] = [{ r: 0, y: -60 }, { r: 1.08, y: -22 }, { r: 1, y: 0 }, { f: .4 }, { f: .8 }, { f: 1 }, { t: rTop * .66 }, { t: rTop * .33 }, { t: 0 }];
  for (let j = 0; j < rings.length; j++) for (let k = 0; k < segments; k++) {
    const ring = rings[j], a = k / segments * Math.PI * 2, o = outline(a), ca = Math.cos(a), sa = Math.sin(a);
    let y: number, r: number, wall = 0;
    if ('y' in ring) { y = ring.y * size; r = ring.r * o; }
    else if ('f' in ring) {
      const H = top(rTop * o * ca, rTop * o * sa, 1); y = ring.f * H;
      wall = n3(ca * 1.8, y / 14, sa * 1.8); r = wallAt(ring.f) * o * (1 + .06 * wall);
    } else { const rr = ring.t * o; y = top(rr * ca, rr * sa, ring.t / rTop); r = rr; }
    positions.push(rx * r * ca, y, rz * r * sa);
    colors.push(wall < 0 ? Math.min(1, -wall * 1.6) : 0, Math.max(0, Math.min(1, -y / 12)), 0);
  }
  for (let j = 0; j < rings.length - 1; j++) for (let k = 0; k < segments; k++) {
    const n = (k + 1) % segments, a = j * segments + k, b = j * segments + n, c = (j + 1) * segments + k, d = (j + 1) * segments + n;
    if (j === 0) indices.push(a, c, d); else if (j === rings.length - 2) indices.push(a, c, b); else indices.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.setIndex(indices);
  const welded = mergeVertices(g, 1e-4); g.dispose();
  const tiltDeg = (kind === 0 ? 2 + rand() * 4 : 4 + rand() * 6) * Math.PI / 180, axisA = rand() * Math.PI * 2;
  welded.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(axisA), 0, Math.sin(axisA)), tiltDeg));
  welded.computeVertexNormals(); welded.computeBoundingSphere(); return welded;
}

/** Uniformes de la nieve de la isla que usan los icebergs (los mismos valores, por referencia). */
const SHARED_STYLE = ['uSnow', 'uSnowShade', 'uIce', 'uSnowGlint', 'uSnowFwd', 'uStylize'] as const;
/** Material del visor: colores y luz de la nieve del terreno (sin grano de textura). */
function icebergMaterial(style: Record<string, THREE.IUniform>) {
  const U: Record<string, THREE.IUniform> = {};
  for (const k of SHARED_STYLE) U[k] = style[k];
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .8, metalness: 0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying vec3 vBergN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\nvBergN=normalize(mat3(modelMatrix)*objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uSnow, uSnowShade, uIce;
uniform vec4 uSnowGlint, uStylize;
uniform float uSnowFwd;
varying vec3 vWorld;
varying vec3 vBergN;
float gSun = 1.0, gSnowK = 1.0, gGlit = 0.0;
vec3 gN = vec3(0.0, 1.0, 0.0), gGlitN = vec3(0.0, 0.0, 1.0);
${STYL_RAMP}`)
      .replace('#include <color_fragment>', `{
  vec3 nW = normalize(vBergN);
  gN = nW;
  float topK = smoothstep(0.35, 0.8, nW.y);
  vec3 col = mix(mix(uSnowShade, uIce, 0.45), uSnow, topK);
  col = mix(col, uIce * 0.85, vColor.r * 0.7);
  col = mix(col, uIce * 0.55, vColor.g);
  diffuseColor.rgb = col;
  gSnowK = 1.0 - vColor.g;
}
${SNOW_GLINTS}`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);')
      .replace('#include <lights_fragment_begin>', SUN_SHADOW_LIGHTS);
  };
  m.customProgramCacheKey = () => 'iceberg-nieve-terreno';
  return m;
}

/**
 * Lugares en agua abierta alrededor de la isla (fijos por semilla): a 4–15 m de la costa (dentro de la niebla, a la
 * vista desde la isla) y a más de 7 m entre sí. `seaDistance(x, z)`: metros hasta la costa (0 en tierra).
 */
function layout(t: IslandTerrain, seaDistance: (x: number, z: number) => number, count: number) {
  const rand = rng(t.spec.seed * 7919 + 17), spots: THREE.Vector3[] = [], R = t.half + 14;
  for (let i = 0; i < 600 && spots.length < count; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R, x = Math.cos(a) * r, z = Math.sin(a) * r, d = seaDistance(x, z);
    if (d < 4 || d > 15 || spots.some(p => Math.hypot(p.x - x, p.z - z) < 7)) continue;
    spots.push(new THREE.Vector3(x, 0, z));
  }
  return spots;
}

export function createIslandIcebergs(t: IslandTerrain, style: Record<string, THREE.IUniform>, seaDistance: (x: number, z: number) => number) {
  const group = new THREE.Group(); group.name = 'Icebergs · decorativos';
  group.position.y = t.seaY;
  const material = icebergMaterial(style);
  const spots = layout(t, seaDistance, t.half > 20 ? 8 : 6);
  const geometries = spots.map((_, i) => icebergGeometry(BERG_KINDS[i], i + 1 + t.spec.seed * 31));
  spots.forEach((p, i) => {
    const mesh = new THREE.Mesh(geometries[i], material);
    mesh.name = BERG_FORMS[BERG_KINDS[i]] + ' ' + (i + 1);
    mesh.scale.setScalar(BERG_SCALE * (0.75 + 0.5 * ((i * 0.618) % 1)));
    mesh.position.copy(p); mesh.rotation.y = i * .79 + .3; mesh.userData.anchor = p.clone();
    group.add(mesh);
  });
  return {
    group,
    stats: () => ({ count: spots.length, triangles: geometries.reduce((n, g) => n + g.index!.count / 3, 0) }),
    /** Flotación del visor (vaivén lento y leve deriva), a la escala de la isla. */
    animate(seconds: number) {
      const k = BERG_SCALE;
      group.children.forEach((m, i) => {
        const phase = i * 2.17, a = m.userData.anchor as THREE.Vector3;
        m.position.x = a.x + 6 * k * Math.sin(seconds * .30 + phase); m.position.z = a.z + 3 * k * Math.sin(seconds * .36 + phase + .4);
        m.position.y = k * (3 * Math.sin(seconds * .70 + phase) + .5 * Math.sin(seconds * 1.05 + phase));
        m.rotation.x = .045 * Math.sin(seconds * .58 + phase); m.rotation.z = .060 * Math.sin(seconds * .65 + phase + .7);
      });
    },
    dispose() { geometries.forEach(g => g.dispose()); material.dispose(); },
  };
}
