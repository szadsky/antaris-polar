import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { IslandTerrain } from './island-terrain';
import { createFlag } from './flag';

/**
 * Estructuras antárticas (modelos 3D decorativos: base, estación de comunicaciones, antena parabólica, vehículo oruga) apoyadas en la isla de práctica.
 * Son reconstrucciones artísticas: no representan instalaciones reales ni su ubicación. Cada una va en su lugar fijo de
 * la isla (STRUCTURES[].poses, elegido a mano con "Mover estructuras"); en una isla sin lugar fijo, se ubica sola en un
 * llano cerca del punto de aparición, sin pisar a las demás. Sin sombra en el piso. El pingüino no las atraviesa.
 */
export interface BasePose { x: number; z: number; /** giro (rad) */ yaw: number; /** altura del modelo (m) */ height: number }

export interface StructureSpec {
  id: string;
  name: string;
  /** Archivo (relativo a la carpeta pública): GLB con Meshopt y texturas WebP. */
  url: string;
  /** Altura por defecto (m): los GLB no traen unidades. */
  height: number;
  /** Lugar fijo por isla (m desde el centro de la isla; giro en radianes). */
  poses: Record<string, BasePose>;
  /** Bandera del modelo reemplazada por una que flamea (coordenadas locales de la malla del GLB, ver FlagSwap). */
  flag?: FlagSwap;
}
type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
/**
 * Bandera fija del modelo → bandera que flamea. `cloth`: caja de la tela (se quitan todos sus triángulos);
 * `nearPole`: franja junto al mástil (se quitan solo los triángulos de color de bandera: celeste o blanco; el mástil gris
 * queda). La nueva se cuelga del mástil en `hoist` (borde de arriba, junto al mástil), con `up` y `out` (a lo largo de
 * la tela) como ejes y `length` × `height` de tamaño, todo en unidades de la malla.
 */
export interface FlagSwap { cloth: Box; nearPole: Box; hoist: [number, number, number]; up: [number, number, number]; out: [number, number, number]; length: number; height: number }

export const STRUCTURES: StructureSpec[] = [
  { id: 'base', name: 'Base antártica', url: 'assets/models/base-antartica-web.glb', height: 5,
    // elegido con "Mover estructuras" (16/11/2026; tamaños ajustados el mismo día)
    poses: { sendero: { x: -6.49, z: 13.16, yaw: -4.2124, height: 6.5 } },
    // bandera del techo, ubicada en la malla el 16/11/2026 (el modelo tiene el eje vertical en −z)
    flag: { cloth: { x0: 0.257, x1: 0.575, y0: 0.415, y1: 0.53, z0: -0.335, z1: -0.07 }, nearPole: { x0: 0.215, x1: 0.257, y0: 0.415, y1: 0.53, z0: -0.318, z1: -0.07 },
      hoist: [0.252, 0.455, -0.317], up: [0, 0, -1], out: [1, 0, 0], length: 0.31, height: 0.205 } },
  { id: 'comunicaciones', name: 'Estación de comunicaciones', url: 'assets/models/estacion-comunicaciones-web.glb', height: 5,
    // elegido con "Mover estructuras" (16/11/2026; tamaños ajustados el mismo día)
    poses: { sendero: { x: 6.19, z: 17.41, yaw: 2.9562, height: 6 } } },
  { id: 'antena', name: 'Antena parabólica', url: 'assets/models/antena-parabolica-web.glb', height: 3.5,
    // elegido con "Mover estructuras" (16/11/2026; tamaños ajustados el mismo día)
    poses: { sendero: { x: 14.55, z: 18.99, yaw: -1.1236, height: 4.5 } } },
  { id: 'oruga', name: 'Vehículo oruga', url: 'assets/models/vehiculo-oruga-web.glb', height: 2.6,
    // elegido con "Mover estructuras" (16/11/2026; tamaños ajustados el mismo día)
    poses: { sendero: { x: 18.27, z: 13.19, yaw: -0.4382, height: 3.5 } } },
];

const MARGIN = 0.35; // m alrededor de la planta que el pingüino no pisa

export function placeIslandBase(gltf: GLTF, t: IslandTerrain, home: { x: number; z: number }, viewAzimuth: number, pose: Partial<BasePose> & { height: number },
  o: { name: string; avoid?: (x: number, z: number) => boolean; flag?: FlagSwap } = { name: 'estructura' }) {
  const model = gltf.scene;
  // Planta centrada en el origen del grupo, apoyada en y = 0; la escala se aplica al grupo interior.
  const inner = new THREE.Group();
  inner.add(model);
  const box = new THREE.Box3().setFromObject(model), raw = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  let triangulos = 0;
  model.traverse((m) => { if (m instanceof THREE.Mesh) { m.castShadow = false; m.receiveShadow = false; triangulos += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3; } });
  const group = new THREE.Group(); group.name = `${o.name} (modelo decorativo)`;
  group.add(inner);
  const flag = o.flag ? swapFlag(model, o.flag) : null;

  const cur: BasePose = { x: 0, z: 0, yaw: 0, height: pose.height };
  let halfW = 0, halfD = 0;
  const dims = () => { const k = cur.height / raw.y; halfW = (raw.x * k) / 2; halfD = (raw.z * k) / 2; inner.scale.setScalar(k); };
  dims();
  const toWorld = (lx: number, lz: number, x = cur.x, z = cur.z, yaw = cur.yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + lx * c + lz * s, z - lx * s + lz * c]; };
  /** Altura más baja del relieve bajo la planta (queda apoyada, apenas hundida, sin rendijas). */
  const groundY = (x: number, z: number, yaw: number) => {
    let lo = Infinity;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const [wx, wz] = toWorld((i / 2) * halfW, (j / 2) * halfD, x, z, yaw); lo = Math.min(lo, t.sample(wx, wz)); }
    return lo;
  };
  /** Ubica la estructura (m, origen en el centro de la isla), apoyada en el relieve. */
  function setPose(p: Partial<BasePose>) {
    for (const k of ['x', 'z', 'yaw', 'height'] as const) if (p[k] !== undefined) cur[k] = p[k]!;
    dims();
    const y = groundY(cur.x, cur.z, cur.yaw) - 0.05;
    group.position.set(cur.x, y, cur.z); group.rotation.y = cur.yaw;
    group.updateMatrixWorld(true);
  }

  // Lugar automático: llano (poca diferencia de altura en la planta), en tierra firme, sin hielo, a 2–14 m de la
  // aparición y del lado opuesto a la cámara (delante del pingüino), con el frente (+z del modelo) hacia él, sin pisar
  // a las demás estructuras.
  let placed = true;
  if (pose.x === undefined || pose.z === undefined) {
    const radius = Math.hypot(halfW, halfD), ahead = Math.atan2(-Math.sin(viewAzimuth), -Math.cos(viewAzimuth));
    let best: { x: number; z: number; yaw: number; score: number } | null = null;
    for (let dist = radius + 2; dist <= radius + 14; dist += 0.5) for (let da = -1.4; da <= 1.4; da += 0.1) {
      const a = ahead + da, x = home.x + Math.cos(a) * dist, z = home.z + Math.sin(a) * dist, yaw = Math.atan2(home.x - x, home.z - z);
      let lo = Infinity, hi = -Infinity, ok = true;
      for (let i = -2; i <= 2 && ok; i++) for (let j = -2; j <= 2 && ok; j++) {
        const [wx, wz] = toWorld((i / 2) * (halfW + MARGIN), (j / 2) * (halfD + MARGIN), x, z, yaw);
        if (Math.abs(wx) > t.half - 1 || Math.abs(wz) > t.half - 1 || o.avoid?.(wx, wz)) { ok = false; break; }
        const h = t.sample(wx, wz);
        if (h < t.seaY + 0.25 || t.ice(wx, wz) > 0.3 || t.slope(wx, wz) > 0.45) { ok = false; break; }
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (!ok) continue;
      const score = (hi - lo) * 4 + Math.abs(dist - radius - 5) * 0.08 + Math.abs(da) * 0.4;
      if (!best || score < best.score) best = { x, z, yaw, score };
    }
    if (best) setPose(best); else { placed = false; group.visible = false; }
  } else setPose({ x: pose.x, z: pose.z, yaw: pose.yaw ?? 0 });

  return {
    group, model, name: o.name, get placed() { return placed; },
    pose: () => ({ ...cur }),
    /** Anima lo que se mueve (la bandera). */
    update(t: number) { flag?.update(t); },
    setPose(p: Partial<BasePose>) { placed = true; group.visible = true; setPose(p); },
    /** Planta (con margen) que el pingüino no pisa. */
    blocks(x: number, z: number, extra = 0) {
      if (!placed) return false;
      const dx = x - cur.x, dz = z - cur.z, c = Math.cos(cur.yaw), s = Math.sin(cur.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c;
      return Math.abs(lx) < halfW + MARGIN + extra && Math.abs(lz) < halfD + MARGIN + extra;
    },
    stats: () => ({ triangulos, ancho: +(2 * halfW).toFixed(2), fondo: +(2 * halfD).toFixed(2), alto: cur.height, x: +cur.x.toFixed(2), z: +cur.z.toFixed(2), giro: Math.round(cur.yaw * 180 / Math.PI) }),
  };
}
export type IslandStructure = ReturnType<typeof placeIslandBase>;

/** Quita la bandera fija de la malla (tela y restos de color junto al mástil) y cuelga una que flamea en el mástil. */
function swapFlag(model: THREE.Object3D, f: FlagSwap) {
  let mesh: THREE.Mesh | null = null;
  model.traverse((m) => { if (!mesh && m instanceof THREE.Mesh) mesh = m; });
  if (!mesh) return null;
  const m = mesh as THREE.Mesh, g = m.geometry, pos = g.getAttribute('position'), uv = g.getAttribute('uv'), index = g.index;
  if (!index || !uv) return null;
  // Color de la textura (para la franja junto al mástil): se lee una vez del mapa base.
  const img = (m.material as THREE.MeshStandardMaterial).map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  let data: Uint8ClampedArray | null = null, W = 0, H = 0;
  if (img) { const c = document.createElement('canvas'); W = c.width = img.width; H = c.height = img.height; const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0); data = ctx.getImageData(0, 0, W, H).data; }
  const flagColor = (u: number, v: number) => {
    if (!data) return true;
    const o = (Math.min(H - 1, Math.max(0, Math.floor(v * H))) * W + Math.min(W - 1, Math.max(0, Math.floor(u * W)))) * 4;
    const r = data[o] / 255, gg = data[o + 1] / 255, b = data[o + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
    if (mx === mn) return l > 0.72;
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (gg - b) / d + (gg < b ? 6 : 0) : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h *= 60;
    return (h > 185 && h < 230 && s > 0.2) || l > 0.72; // celeste o blanco
  };
  const inBox = (b: Box, x: number, y: number, z: number) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;
  const keep: number[] = [];
  for (let t = 0; t < index.count / 3; t++) {
    let x = 0, y = 0, z = 0, u = 0, v = 0;
    for (let k = 0; k < 3; k++) { const i = index.getX(t * 3 + k); x += pos.getX(i) / 3; y += pos.getY(i) / 3; z += pos.getZ(i) / 3; u += uv.getX(i) / 3; v += uv.getY(i) / 3; }
    if (inBox(f.cloth, x, y, z) || (inBox(f.nearPole, x, y, z) && flagColor(u, v))) continue;
    for (let k = 0; k < 3; k++) keep.push(index.getX(t * 3 + k));
  }
  g.setIndex(keep);
  const flag = createFlag(f.length, f.height);
  // Ejes de la tela en la malla: x = a lo largo (out), y = arriba (up), z = normal (out × up).
  const X = new THREE.Vector3(...f.out), Y = new THREE.Vector3(...f.up), Z = new THREE.Vector3().crossVectors(X, Y);
  flag.mesh.matrixAutoUpdate = false;
  flag.mesh.matrix.makeBasis(X, Y, Z).setPosition(...f.hoist);
  m.add(flag.mesh);
  return flag;
}
