import * as THREE from 'three';
import { CAM_H, F_PX, IMG, PLANES, onPlane, onWater } from './camara';

/**
 * Fondo pintado (reconstrucción artística, capas del zip): cielo, cumbres y laderas como planos verticales a
 * 20, 9 y 5 km, y barcos y boyas como planos parados sobre el agua en su línea de flotación. Cada plano se arma con
 * los rayos exactos de la cámara del hero: desde la posición inicial, cada píxel cae donde estaba en la referencia.
 * Al mover la cámara, la distancia de cada plano da el parallax entre capas. Dentro de cumbres y laderas, la
 * profundidad de Depth Anything V2 (una pasada por capa, scripts/profundidad-montanas.mjs: R = cumbres, G = laderas)
 * corre los VÉRTICES de una malla densa (malla elástica): la imagen se estira donde la profundidad salta, nunca se
 * duplica (con el desplazamiento por píxel del primer intento, el borde de una ladera aparecía dos veces).
 * Reparto del efecto (pedido 16/11/2026: «los montes con menos depth, las montañas con más, son más profundas»):
 * las cumbres usan todo el rango de su profundidad (picos quietos, faldas adelante: se lee el volumen de cada
 * montaña) y las laderas se mueven casi en bloque, con poco relieve propio.
 */

const SCENE_ROWS = { cumbres: [140, 452], laderas: [320, 540] } as const;
const DEPTH_ROWS = [140, 540] as const;

/**
 * Ajustes de profundidad de cada capa (los edita el panel, src/panel.ts). El desplazamiento de un vértice, en px de la
 * referencia, es `movimiento × (mezcla(inicio, fin, curva(contraste(prof) + relieve)) + offset) × intensidad` más un
 * corrimiento fijo. Con la cámara en reposo el movimiento es 0: solo el corrimiento cambia el cuadro.
 */
export interface LayerDepth {
  /** Multiplica todo el desplazamiento de la capa. */
  intensidad: number;
  /** Tramo de la escala que usa la capa (0 = quieto, 1 = el máximo del movimiento). */
  inicio: number; fin: number;
  /** Se suma a la profundidad ya mapeada: corre el «pivote» (negativo: lo lejano va en contra). */
  offset: number;
  /** Exponente de la profundidad (< 1 adelanta los medios tonos, > 1 los atrasa). */
  curva: number;
  /** Contraste de la profundidad alrededor de 0,5. */
  contraste: number;
  /** Cuánto se suma el relieve local (relieve-montanas.webp): volumen propio de cada cresta y falda. */
  relieve: number;
  /** Corrimiento fijo de la capa (px de la referencia), también en reposo. */
  corrimientoX: number; corrimientoY: number;
}
export const DEPTH_DEFAULTS: Record<'cumbres' | 'laderas', LayerDepth> = {
  cumbres: { intensidad: 0.2, inicio: 0, fin: 1, offset: 0, curva: 1, contraste: 1.4, relieve: 2, corrimientoX: 0, corrimientoY: 0 },
  laderas: { intensidad: 1, inicio: 0.2, fin: 0.4, offset: 0, curva: 1, contraste: 1, relieve: 0.15, corrimientoX: 0, corrimientoY: 0 },
};

/** Plano que cubre el rectángulo de la imagen [x0, x1] × [y0, y1] a `dist` m, en una grilla de `nx` × `segs`. */
function imagePlane(x0: number, y0: number, x1: number, y1: number, dist: number, segs = 24, nx = 8) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= segs; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx, y = y0 + ((y1 - y0) * j) / segs, p = onPlane(x, y, dist);
    pos.push(p[0], p[1] + CAM_H, p[2]); uv.push(i / nx, 1 - j / segs);
  }
  for (let j = 0; j < segs; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Parallax por profundidad dentro de una capa, como malla elástica: cada vértice se corre `uParallax × profundidad`
 * (px de la referencia; 0 = lejos, quieto) y, dentro de la capa, lo más cercano gana en la profundidad.
 */
function layerMaterial(map: THREE.Texture, depth: THREE.Texture, relief: THREE.Texture, rows: readonly [number, number], parallax: { value: THREE.Vector2 }, channel: 0 | 1, dist: number) {
  const d0 = DEPTH_DEFAULTS[channel === 0 ? 'cumbres' : 'laderas'];
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: true, toneMapped: false,
    uniforms: {
      uMap: { value: map }, uDepth: { value: depth }, uRelief: { value: relief }, uParallax: parallax,
      // canal de la profundidad de esta capa (R = cumbres, G = laderas) y sus ajustes (LayerDepth)
      uChannel: { value: new THREE.Vector3(channel === 0 ? 1 : 0, channel === 1 ? 1 : 0, 0) },
      uRange: { value: new THREE.Vector2(d0.inicio, d0.fin) },
      uShape: { value: new THREE.Vector4(d0.contraste, d0.curva, d0.relieve, d0.offset) },
      uScale: { value: d0.intensidad },
      uShift: { value: new THREE.Vector2(d0.corrimientoX, d0.corrimientoY) },
      uRows: { value: new THREE.Vector2(rows[0], rows[1]) }, uDepthRows: { value: new THREE.Vector2(DEPTH_ROWS[0], DEPTH_ROWS[1]) },
      uImg: { value: new THREE.Vector2(IMG.w, IMG.h) },
      uMetersPerPx: { value: dist / F_PX },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D uDepth, uRelief;
      uniform vec2 uParallax, uRows, uDepthRows, uImg, uRange, uShift;
      uniform vec3 uChannel;
      uniform vec4 uShape; // contraste, curva, relieve, offset
      uniform float uMetersPerPx, uScale;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec2 px = vec2(uv.x * uImg.x, mix(uRows.y, uRows.x, uv.y));
        vec2 duv = vec2(px.x / uImg.x, 1.0 - (px.y - uDepthRows.x) / (uDepthRows.y - uDepthRows.x));
        float d = dot(textureLod(uDepth, duv, 0.0).rgb, uChannel);
        float r = (dot(textureLod(uRelief, duv, 0.0).rgb, uChannel) - 0.5) * 2.0; // relieve local, −1…1
        float dd = clamp((d - 0.5) * uShape.x + 0.5 + uShape.z * r, 0.0, 1.0);
        float eff = (mix(uRange.x, uRange.y, pow(dd, uShape.y)) + uShape.w) * uScale;
        vec3 p = position;
        p.x += (uParallax.x * eff + uShift.x) * uMetersPerPx;
        p.y -= (uParallax.y * eff + uShift.y) * uMetersPerPx;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        clip.z -= eff * 2e-5 * clip.w; // si la malla se pliega, lo cercano tapa a lo lejano (sin cambiar la imagen)
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(uMap, clamp(vUv, vec2(0.0005), vec2(0.9995)));
        if (c.a < 0.02) discard;
        gl_FragColor = c;
        #include <colorspace_fragment>
      }`,
  });
}

export interface BoatSprite { x: number; y: number; w: number; h: number; ax: number; ay: number; flotacion: number }

export async function createBackdrop(base: string) {
  const loader = new THREE.TextureLoader();
  const tex = async (f: string, srgb = true) => {
    const t = await loader.loadAsync(base + f);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const [sky, peaks, slopes, depth, relief, boatsTex, boatsInfo] = await Promise.all([
    tex('cielo.webp'), tex('cumbres.webp'), tex('laderas.webp'), tex('profundidad-montanas.webp', false), tex('relieve-montanas.webp', false), tex('barcos.webp'),
    fetch(base + 'barcos.json').then((r) => r.json() as Promise<{ atlas: [number, number]; sprites: BoatSprite[] }>),
  ]);
  const group = new THREE.Group();
  group.name = 'fondo-pintado';
  const parallax = { value: new THREE.Vector2() };

  // Cielo: opaco, al fondo; se amplía 12 % por lado para que el movimiento de la cámara no muestre bordes.
  const m = 0.12, skyGeo = imagePlane(-IMG.w * m, -IMG.h * m, IMG.w * (1 + m), IMG.h * (1 + m), PLANES.cielo);
  const skyUv = skyGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < skyUv.count; i++) skyUv.setXY(i, -m + skyUv.getX(i) * (1 + 2 * m), -m + skyUv.getY(i) * (1 + 2 * m));
  sky.wrapS = sky.wrapT = THREE.MirroredRepeatWrapping;
  const skyMesh = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: sky, toneMapped: false, depthWrite: false, fog: false }));
  skyMesh.renderOrder = -10; skyMesh.name = 'cielo';
  group.add(skyMesh);

  for (const [name, map, dist, order] of [['cumbres', peaks, PLANES.cumbres, -9], ['laderas', slopes, PLANES.laderas, -8]] as const) {
    const rows = SCENE_ROWS[name];
    // 3 % más ancho a cada lado: la capa repite su borde (clamp) y no aparece el cielo detrás al mover la cámara.
    // malla de 8 × 6 px (≈ 222 × 37–52 cuadros, ~40 k triángulos entre las dos): la profundidad se toma por vértice.
    // Con 4 px eran 118 k triángulos y +2,6 ms por cuadro sin diferencia visible (la profundidad viene suavizada).
    const g = imagePlane(-IMG.w * 0.03, rows[0], IMG.w * 1.03, rows[1], dist, Math.round((rows[1] - rows[0]) / 6), Math.round((IMG.w * 1.06) / 8));
    const uvA = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvA.count; i++) uvA.setX(i, -0.03 + uvA.getX(i) * 1.06);
    const mesh = new THREE.Mesh(g, layerMaterial(map, depth, relief, rows, parallax, name === 'cumbres' ? 0 : 1, dist));
    mesh.renderOrder = order; mesh.name = name; mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Barcos y boyas: un plano vertical por sprite, apoyado en el agua donde la referencia pone su línea de flotación.
  const [aw, ah] = boatsInfo.atlas, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const sprites = boatsInfo.sprites.map((s) => ({ s, dist: -onWater(s.x + s.w / 2, s.flotacion)[2] })).sort((a, b) => b.dist - a.dist);
  for (const { s, dist } of sprites) {
    const v = pos.length / 3;
    for (const [x, y, u, w] of [[s.x, s.y, s.ax, s.ay], [s.x + s.w, s.y, s.ax + s.w, s.ay], [s.x, s.y + s.h, s.ax, s.ay + s.h], [s.x + s.w, s.y + s.h, s.ax + s.w, s.ay + s.h]]) {
      const p = onPlane(x, y, dist);
      pos.push(p[0], p[1] + CAM_H, p[2]); uv.push(u / aw, 1 - w / ah);
    }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  const boatsGeo = new THREE.BufferGeometry();
  boatsGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  boatsGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  boatsGeo.setIndex(idx);
  boatsTex.generateMipmaps = true;
  const boats = new THREE.Mesh(boatsGeo, new THREE.MeshBasicMaterial({ map: boatsTex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, fog: false }));
  boats.renderOrder = -5; boats.name = 'barcos'; boats.frustumCulled = false;
  group.add(boats);

  const layerUniforms = (name: 'cumbres' | 'laderas') => ((group.getObjectByName(name) as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
  return {
    group, parallax,
    /** Aplica los ajustes de profundidad de una capa (panel). */
    setDepth(name: 'cumbres' | 'laderas', v: LayerDepth) {
      const u = layerUniforms(name);
      u.uRange.value.set(v.inicio, v.fin);
      u.uShape.value.set(v.contraste, v.curva, v.relieve, v.offset);
      u.uScale.value = v.intensidad;
      u.uShift.value.set(v.corrimientoX, v.corrimientoY);
    },
    boatDistances: sprites.map(({ dist }) => Math.round(dist)),
    dispose() { group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); [sky, peaks, slopes, depth, relief, boatsTex].forEach((t) => t.dispose()); },
  };
}
