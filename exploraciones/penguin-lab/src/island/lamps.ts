import * as THREE from 'three';

/**
 * Faroles que titilan como si cada uno tuviera un desperfecto propio (ruido de luz decorativo, no un dato). Los lentes
 * se separan de la malla del modelo (sus triángulos pasan a una malla propia, con el mismo mapa como luz emitida) y se
 * suma un halo suave que mira a la cámara. Cada farol tiene su semilla: falla a destiempo de los demás (apagones cortos,
 * tartamudeos rápidos y un zumbido leve). Costo: un material y un halo por farol; el titileo se calcula en la CPU (unas
 * operaciones por farol y cuadro).
 */
export type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
export interface LampSpec { box: Box; seed: number }

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** Intensidad (0–1) de un farol con desperfecto: casi siempre prendido, con fallas a su propio ritmo. */
export function flicker(t: number, seed: number) {
  const rate = 3 + hash(seed) * 5;                 // ventanas de 0,12–0,33 s, distinto por farol
  const b = Math.floor(t * rate + seed * 17.3), r = hash(b * 1.73 + seed);
  let v = 1;
  if (r < 0.14) v = 0.04 + 0.2 * hash(b + 0.5);    // apagón corto
  else if (r < 0.27) v = Math.sin(t * (70 + 40 * hash(seed + 2)) + seed) > 0 ? 1 : 0.12; // tartamudeo
  else if (r < 0.33) v = 0.55;                      // baja de tensión
  // a veces un apagón largo (~1 s)
  const lb = Math.floor(t * 0.9 + seed * 5.1);
  if (hash(lb * 3.1 + seed * 0.7) < 0.08) v *= 0.06 + 0.1 * hash(lb + seed);
  return v * (0.94 + 0.06 * Math.sin(t * 13 + seed * 4));
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,200,1)'); grad.addColorStop(0.25, 'rgba(255,225,170,0.55)'); grad.addColorStop(1, 'rgba(255,210,150,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Color de lente: claro y cálido (más rojo que azul). El lente son pocos triángulos grandes con degradé: se mira el
 *  color en su centro, que puede ser crema más oscuro que el centro del lente; la carcasa gris oscura queda afuera. */
const isLens = (r: number, g: number, b: number) => r > 165 && r >= g && g >= b - 4 && r - b > 12 && (r + g + b) / 3 > 150;

export function addLamps(model: THREE.Object3D, lamps: LampSpec[]) {
  let mesh: THREE.Mesh | null = null;
  model.traverse((m) => { if (!mesh && m instanceof THREE.Mesh) mesh = m; });
  if (!mesh || !lamps.length) return null;
  const m = mesh as THREE.Mesh, g = m.geometry, pos = g.getAttribute('position'), uv = g.getAttribute('uv'), index = g.index;
  const base = m.material as THREE.MeshStandardMaterial, img = base.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!index || !uv || !img) return null;
  const c = document.createElement('canvas'), W = (c.width = img.width), H = (c.height = img.height), ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;
  const lens = (u: number, v: number) => { const o = (Math.min(H - 1, Math.max(0, Math.floor(v * H))) * W + Math.min(W - 1, Math.max(0, Math.floor(u * W)))) * 4; return isLens(data[o], data[o + 1], data[o + 2]); };
  const inBox = (b: Box, x: number, y: number, z: number) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1;
  const perLamp: number[][] = lamps.map(() => []), keep: number[] = [];
  for (let t = 0; t < index.count / 3; t++) {
    let x = 0, y = 0, z = 0, u = 0, v = 0;
    for (let k = 0; k < 3; k++) { const i = index.getX(t * 3 + k); x += pos.getX(i) / 3; y += pos.getY(i) / 3; z += pos.getZ(i) / 3; u += uv.getX(i) / 3; v += uv.getY(i) / 3; }
    const l = lamps.findIndex((L) => inBox(L.box, x, y, z));
    const tri = [index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)];
    if (l >= 0 && lens(u, v)) perLamp[l].push(...tri); else keep.push(...tri);
  }
  g.setIndex(keep);
  const glowTex = glowTexture(), parts: { mat: THREE.MeshStandardMaterial; glow: THREE.Sprite; seed: number }[] = [];
  lamps.forEach((L, i) => {
    if (!perLamp[i].length) return;
    const sub = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) sub.setAttribute(name, g.getAttribute(name));
    sub.setIndex(perLamp[i]);
    // centro y radio del lente con SUS vértices (computeBoundingSphere usaría todos los del modelo)
    const box = new THREE.Box3(), pt = new THREE.Vector3();
    for (const vi of perLamp[i]) box.expandByPoint(pt.fromBufferAttribute(pos, vi));
    sub.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const mat = base.clone();
    mat.emissive = new THREE.Color('#ffe2b0'); mat.emissiveMap = base.map; mat.emissiveIntensity = 1.1;
    const lensMesh = new THREE.Mesh(sub, mat); lensMesh.name = `farol ${i + 1}`;
    m.add(lensMesh);
    // halo en el centro del lente
    const ctr = sub.boundingSphere!.center;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffe6bf', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    glow.position.copy(ctr); glow.scale.setScalar(Math.max(0.08, sub.boundingSphere!.radius * 2.6)); glow.name = `halo farol ${i + 1}`;
    m.add(glow);
    parts.push({ mat, glow, seed: L.seed });
  });
  return {
    count: parts.length,
    update(t: number) {
      for (const p of parts) {
        const v = flicker(t, p.seed);
        p.mat.emissiveIntensity = 0.05 + 1.1 * v;
        p.mat.color.setScalar(0.28 + 0.72 * v); // apagado, el lente se ve gris (de día, el blanco de la textura parecía prendido)
        (p.glow.material as THREE.SpriteMaterial).opacity = 0.22 * v; // halo muy sutil (con 0,85 se veía sobreexpuesto)
      }
    },
  };
}
