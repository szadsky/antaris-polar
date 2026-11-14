import * as THREE from "three";
import type { PreviewMsg } from "./worker";

/**
 * Precarga "construcción" por pasos, con el relieve REMA real (alturas de la vista previa del worker). Mientras se
 * arma, solo hay malla (nodos y conexiones): nada se dibuja fuera de la grilla.
 *  1. aparece una malla gruesa (9 × 9 nodos), plana al nivel del mar, desde la base hacia afuera;
 *  2. la malla se extruye hasta la altura real de sus nodos, en ola desde la base;
 *  3. tres refinamientos (17, 33 y 65 nodos por lado): cada nodo nuevo nace sobre la superficie del paso anterior
 *     (interpolada) y se acomoda a su altura real; la malla es cada vez más fiel; las conexiones viejas se apagan;
 *  4. si la carga sigue, un pulso tenue recorre la malla. Al terminar: se completan los pasos que falten y la malla
 *     se transforma en el terreno: un frente turbulento (plasma) recorre el suelo desde la base; detrás, el terreno
 *     real con su textura (el único relleno: antes, todo es malla); delante, la malla. En el mundo, no en la pantalla:
 *     nunca se superponen y el fondo no se toca.
 *
 * Es el dato, no una forma inventada: cada nodo está en la posición y a la altura REMA (misma exageración) que el
 * terreno; los pasos intermedios son interpolaciones de esos mismos nodos. Costo bajo: ≤ 65 × 65 nodos, sin
 * texturas ni luces.
 */

export interface ConstructionStats { nodos: number; conexiones: number; armadoMs: number }

const LEVELS = 4; // 9, 17, 33 y 65 nodos por lado
const FINE = 8 * 8 + 1; // 65

function build(p: PreviewMsg, k: number) {
  const { heights: h, width: w, height: hh, cellM } = p;
  const sea = p.seaLevelM ?? 0;
  const halfW = ((w - 1) * cellM) / 2, halfD = ((hh - 1) * cellM) / 2;
  // altura REMA (bilineal sobre la grilla de malla; sin dato o bajo el mar → nivel del mar)
  const sample = (fx: number, fz: number) => {
    const x = Math.min(Math.max(fx, 0), w - 1.001), z = Math.min(Math.max(fz, 0), hh - 1.001);
    const i = Math.floor(x), j = Math.floor(z), ax = x - i, az = z - j;
    const g = (a: number, b: number) => { const v = h[b * w + a]; return Number.isFinite(v) ? Math.max(v, sea) : sea; };
    return (g(i, j) * (1 - ax) + g(i + 1, j) * ax) * (1 - az) + (g(i, j + 1) * (1 - ax) + g(i + 1, j + 1) * ax) * az;
  };
  const n = FINE, H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = sample((i / (n - 1)) * (w - 1), (j / (n - 1)) * (hh - 1));
  let top = sea;
  for (const v of H) top = Math.max(top, v);
  // nivel en que aparece cada nodo (0 = malla gruesa) y su altura aproximada en cada paso
  const spacing = (L: number) => 1 << (LEVELS - 1 - L); // 8, 4, 2, 1
  const lvlOf = (i: number, j: number) => { for (let L = 0; L < LEVELS; L++) if (i % spacing(L) === 0 && j % spacing(L) === 0) return L; return LEVELS - 1; };
  const approx = (i: number, j: number, L: number) => {
    const c = spacing(L), i0 = Math.floor(i / c) * c, j0 = Math.floor(j / c) * c, i1 = Math.min(i0 + c, n - 1), j1 = Math.min(j0 + c, n - 1);
    const tx = i1 > i0 ? (i - i0) / (i1 - i0) : 0, tz = j1 > j0 ? (j - j0) / (j1 - j0) : 0;
    return (H[j0 * n + i0] * (1 - tx) + H[j0 * n + i1] * tx) * (1 - tz) + (H[j1 * n + i0] * (1 - tx) + H[j1 * n + i1] * tx) * tz;
  };
  const rMax = Math.hypot(halfW, halfD);
  const X = (i: number) => (i / (n - 1)) * 2 * halfW - halfW, Z = (j: number) => (j / (n - 1)) * 2 * halfD - halfD;
  const delayOf = (i: number, j: number) => Math.min(1, Math.hypot(X(i), Z(j)) / rMax);
  const isLand = (i: number, j: number) => H[j * n + i] > sea + 0.5;
  // vértice: posición xz, alturas por paso (h0..h3), nivel de aparición, retardo radial, tierra
  type V = { pos: number[]; hs: number[]; lvl: number[]; delay: number[]; land: number[] };
  const mk = (): V => ({ pos: [], hs: [], lvl: [], delay: [], land: [] });
  const pushV = (v: V, i: number, j: number, lvl: number, delay: number, land: number) => {
    v.pos.push(X(i), 0, Z(j));
    for (let L = 0; L < LEVELS; L++) v.hs.push(approx(i, j, L) * k);
    v.lvl.push(lvl); v.delay.push(delay); v.land.push(land);
  };
  const pts = mk(), edges = mk();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pushV(pts, i, j, lvlOf(i, j), delayOf(i, j), isLand(i, j) ? 1 : 0);
  // conexiones de cada paso entre vecinos a su separación
  for (let L = 0; L < LEVELS; L++) {
    const c = spacing(L);
    for (let j = 0; j < n; j += c) for (let i = 0; i < n; i += c) {
      for (const [i2, j2] of [[i + c, j], [i, j + c]]) {
        if (i2 >= n || j2 >= n) continue;
        const d = Math.max(delayOf(i, j), delayOf(i2, j2)), l = isLand(i, j) || isLand(i2, j2) ? 1 : 0;
        pushV(edges, i, j, L, d, l); pushV(edges, i2, j2, L, d, l);
      }
    }
  }
  const geo = (v: V) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v.pos, 3));
    g.setAttribute("hs", new THREE.Float32BufferAttribute(v.hs, 4));
    g.setAttribute("lvl", new THREE.Float32BufferAttribute(v.lvl, 1));
    g.setAttribute("delay", new THREE.Float32BufferAttribute(v.delay, 1));
    g.setAttribute("land", new THREE.Float32BufferAttribute(v.land, 1));
    return g;
  };
  // superficie para el revelado (REVEAL_GLSL, rvSurface): alturas de la grilla fina × exageración, media precisión
  // (filtrado lineal sin extensiones en WebGL 2)
  const half = new Uint16Array(n * n);
  for (let i = 0; i < n * n; i++) half[i] = THREE.DataUtils.toHalfFloat(H[i] * k);
  const surface = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  surface.magFilter = surface.minFilter = THREE.LinearFilter;
  surface.needsUpdate = true;
  return { points: geo(pts), edges: geo(edges), surface, box: new THREE.Vector3(halfW, halfD, n), sea: sea * k, top: top * k, span: Math.hypot(halfW, halfD), nodes: n * n, links: edges.lvl.length / 2 };
}

// Línea de tiempo T: 0→1 aparece la malla gruesa plana · 1→2 extrusión · 2→3, 3→4, 4→5 refinamientos (todo malla,
// sin relleno: el color llega recién con el revelado) · >5 espera.
const COMMON_VERT = `
  attribute vec4 hs;
  attribute float lvl, delay, land;
  uniform float uT, uSea, uTop;
  varying float vShown, vLand, vPulse;
  varying vec3 vWorld;
  float heightAt(float f) { // f en [0,3]: interpola entre las alturas de los pasos
    float a = floor(f), t = f - a;
    float h0 = a < 0.5 ? hs.x : a < 1.5 ? hs.y : a < 2.5 ? hs.z : hs.w;
    float h1 = a < 0.5 ? hs.y : a < 1.5 ? hs.z : hs.w;
    return mix(h0, h1, smoothstep(0.0, 1.0, t));
  }
  vec3 placed() {
    // extrusión en ola desde la base: cada nodo sube en su propio tramo (los del centro primero)
    float extrude = smoothstep(delay * 0.45, delay * 0.45 + 0.55, clamp(uT - 1.0, 0.0, 1.0));
    float fidelity = clamp(uT - 2.0, 0.0, 3.0);
    vec3 p = position;
    p.y = mix(uSea, heightAt(fidelity), extrude);
    vWorld = p;
    // aparición: paso 0 en T∈[0,1]; paso L≥1 en T∈[L+1, L+2], en ola desde la base
    float t0 = lvl < 0.5 ? 0.0 : lvl + 1.0;
    vShown = smoothstep(t0 + delay * 0.7, t0 + delay * 0.7 + 0.15, uT);
    vLand = land;
    float s = uT - 5.0; // pulso de espera: una banda que sube por la altura real
    vPulse = s > 0.0 ? exp(-pow((hs.w - uSea) / max(uTop - uSea, 1.0) - fract(s / 1.8), 2.0) * 120.0) : 0.0;
    return p;
  }`;

// Revelado final en el terreno (no en la pantalla): un frente que recorre el suelo desde la base hacia afuera, con
// el borde deformado por ruido animado (lóbulos + turbulencia, tipo plasma). revealD(w) = distancia con signo en
// metros (plano XZ del mundo) al frente: negativa adentro (terreno real), positiva afuera (sigue la construcción).
// La usan la malla (se dibuja solo afuera) y los materiales de la escena (solo adentro, ver makeRevealPatch).
// Antes del final uRvR es muy negativo: todo queda afuera.
const REVEAL_GLSL = `
  uniform float uRvR, uRvTime, uRvSpan, uRvOn;
  uniform sampler2D uRvSurf; uniform vec3 uRvBox; // alturas de la grilla fina · (media anchura, media profundidad, nodos)
  float rvHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float rvNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(rvHash(i), rvHash(i + vec2(1.0, 0.0)), f.x), mix(rvHash(i + vec2(0.0, 1.0)), rvHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float rvFbm(vec2 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * rvNoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; } return s; }
  float rvSurface(vec2 xz) {
    vec2 uv = (xz / (2.0 * uRvBox.xy) + 0.5) * ((uRvBox.z - 1.0) / uRvBox.z) + 0.5 / uRvBox.z;
    return texture2D(uRvSurf, uv).r;
  }
  float revealD(vec3 w) {
    vec2 p = w.xz;
    float r = length(p);
    vec2 dir = p / max(r, 1e-3);
    float lobes = rvFbm(dir * 2.3 + vec2(uRvTime * 0.45, -uRvTime * 0.3));
    float turb = rvFbm(p / uRvSpan * 5.0 + vec2(-uRvTime * 0.9, uRvTime * 0.6));
    float edge = uRvR * (0.8 + 0.4 * lobes) + (turb - 0.5) * max(uRvR, 0.0) * 0.22;
    // lo que está por debajo de la superficie del terreno (fondo del mar, zócalo bajo las montañas, pie de las
    // paredes) va atrasado 1,5 m por metro de profundidad: mirando por el borde del frente no se ve el corte oscuro
    // de abajo, y el frente baja por las paredes del diorama. 25 m de tolerancia: la grilla de la malla es más
    // gruesa que el terreno y los valles finos no se atrasan.
    return r - edge + max(rvSurface(p) - w.y - 25.0, 0.0) * 1.5;
  }`;

/**
 * Agrega el revelado a los materiales de la escena (terreno, agua, paredes del diorama, edificios, icebergs): afuera
 * del frente descartan el fragmento; detrás del frente el suelo "se transforma" desde la malla con una banda de
 * plasma (línea de luz, tinte que se desvanece hacia adentro y destellos). Se aplica antes de precompilar (sin
 * compilar dos veces) y queda en el programa: al terminar uRvOn = 0 y el costo es un salto por uniforme.
 */
function makeRevealPatch(u: Record<string, THREE.IUniform>) {
  const done = new WeakSet<THREE.Material>();
  const fragMain = /void\s+main\s*\(\s*\)\s*\{/;
  const patchMaterial = (m: THREE.Material) => {
    if (done.has(m)) return;
    done.add(m);
    const before = m.onBeforeCompile, key = m.customProgramCacheKey;
    m.onBeforeCompile = (s, r) => {
      before.call(m, s, r);
      // materiales de three y ShaderMaterial con sus include (el agua: Water); los pases sin ellos quedan igual
      if (!fragMain.test(s.fragmentShader) || !s.fragmentShader.includes("#include <tonemapping_fragment>")) return;
      // posición local final: `transformed` (de three o propia, como los bloques del LOD, que leen la altura de una
      // textura y reemplazan begin_vertex); sin ella, `position` (el agua Water)
      const local = s.vertexShader.includes("#include <begin_vertex>") || /vec3\s+transformed\b/.test(s.vertexShader) ? "transformed" : "position";
      Object.assign(s.uniforms, u);
      const end = s.vertexShader.lastIndexOf("}");
      s.vertexShader = `varying vec3 vRvW;\n${s.vertexShader.slice(0, end)}
        { vec4 rvP = vec4(${local}, 1.0);
          #ifdef USE_INSTANCING
          rvP = instanceMatrix * rvP;
          #endif
          vRvW = (modelMatrix * rvP).xyz; }
      ${s.vertexShader.slice(end)}`;
      s.fragmentShader = `${REVEAL_GLSL}
        uniform vec3 uRvRim;
        varying vec3 vRvW;
        ${s.fragmentShader}`
        .replace(fragMain, "void main() {\n  float rvD = -1e9;\n  if (uRvOn > 0.5) { rvD = revealD(vRvW); if (rvD > 0.0) discard; }")
        .replace("#include <tonemapping_fragment>", `if (uRvOn > 0.5) {
            float W = uRvSpan * 0.035;
            // el frente: una línea de luz suave sobre la textura del terreno (sin destellos por celdas, que se veían
            // como píxeles) y un brillo leve que se apaga hacia adentro; la textura se ve desde el primer momento
            float core = exp(-abs(rvD) / (W * 0.1));
            float glow = exp(rvD / (W * 0.6));
            gl_FragColor.rgb = gl_FragColor.rgb * (1.0 + 0.35 * glow) + uRvRim * core * 0.9;
          }
          #include <tonemapping_fragment>`);
    };
    // la clave por defecto es el texto de onBeforeCompile: con el envoltorio sería igual para todos, se usa el original
    const isDefault = key === THREE.Material.prototype.customProgramCacheKey;
    m.customProgramCacheKey = () => (isDefault ? before.toString() : key.call(m)) + "|revelado";
    m.needsUpdate = true;
  };
  return (root: THREE.Object3D, skip?: THREE.Object3D) => {
    root.traverse((obj) => {
      if (skip && (obj === skip || obj.parent === skip)) return;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchMaterial(m);
    });
  };
}

export function createConstruction(o: {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls?: { update(): unknown };
  background: THREE.Color;
  preview: PreviewMsg;
  k: number;
  reducedMotion: boolean;
}) {
  const t0 = performance.now();
  const B = build(o.preview, o.k);
  // Revelado en el terreno (REVEAL_GLSL): uniformes compartidos por la malla y por los materiales de la escena.
  // uRvR: radio del frente (m; muy negativo = todo tapado), uRvSpan: media diagonal del recorte (escala del ruido),
  // uRvOn: los materiales de la escena aplican el revelado (al terminar, 0).
  const rv = {
    uRvR: { value: -1e6 },
    uRvTime: { value: 0 },
    uRvSpan: { value: B.span },
    uRvOn: { value: 1 },
    uRvSurf: { value: B.surface },
    uRvBox: { value: B.box },
    uRvRim: { value: new THREE.Color("#bff3ff") },
  };
  const revealPatch = makeRevealPatch(rv);
  const shared = {
    ...rv,
    uT: { value: 0 },
    uSea: { value: B.sea },
    uTop: { value: B.top },
    uNet: { value: 1 },   // opacidad de la malla (nodos y conexiones)
    uInk: { value: new THREE.Color("#46606f") },
    uLandInk: { value: new THREE.Color("#1f7a92") },
    uGlow: { value: new THREE.Color("#8fd3e8") },
  };
  const lineMat = new THREE.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `${COMMON_VERT}
      varying float vKeep;
      void main(){
        gl_Position = projectionMatrix * modelViewMatrix * vec4(placed(), 1.0);
        // las conexiones de un paso se apagan cuando las del siguiente ya están
        vKeep = lvl > 2.5 ? 1.0 : 1.0 - smoothstep(lvl + 2.6, lvl + 3.0, uT);
      }`,
    fragmentShader: `${REVEAL_GLSL}
      uniform float uNet; uniform vec3 uInk, uLandInk, uGlow;
      varying float vShown, vLand, vPulse, vKeep;
      varying vec3 vWorld;
      void main(){
        float rd = revealD(vWorld);
        if (rd < 0.0) discard; // detrás del frente: solo el terreno
        float near = exp(-rd / (uRvSpan * 0.05)); // la malla se "carga" justo antes de transformarse
        float a = vShown * vKeep * mix(0.3, 0.62, vLand) * uNet + near * 0.5;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(mix(mix(uInk, uLandInk, vLand), uGlow, max(vPulse * 0.7, near)), min(a, 1.0));
        #include <colorspace_fragment>
      }`,
  });
  const pointMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uPx: { value: 4 * o.renderer.getPixelRatio() } }, transparent: true, depthWrite: false, toneMapped: false,
    vertexShader: `${COMMON_VERT}
      uniform float uPx;
      void main(){
        gl_Position = projectionMatrix * modelViewMatrix * vec4(placed(), 1.0);
        float pop = 1.0 + 3.2 * vShown * (1.0 - vShown); // el nodo "salta" al aparecer
        // los nodos de pasos gruesos, un poco más grandes (las "esquinas" de cada paso)
        gl_PointSize = uPx * mix(0.7, 1.0, vLand) * mix(1.25, 0.8, lvl / 3.0) * pop * vShown;
      }`,
    fragmentShader: `${REVEAL_GLSL}
      uniform float uNet; uniform vec3 uInk, uLandInk, uGlow;
      varying float vShown, vLand, vPulse;
      varying vec3 vWorld;
      void main(){
        float rd = revealD(vWorld);
        if (rd < 0.0) discard;
        float near = exp(-rd / (uRvSpan * 0.05));
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float a = min(vShown * mix(0.55, 0.95, vLand) * uNet + near, 1.0) * smoothstep(0.5, 0.32, r);
        if (a <= 0.003) discard;
        gl_FragColor = vec4(mix(mix(uInk, uLandInk, vLand), uGlow, max(max(vPulse, 0.25 * vLand), near)), a);
        #include <colorspace_fragment>
      }`,
  });
  const lines = new THREE.LineSegments(B.edges, lineMat);
  const points = new THREE.Points(B.points, pointMat);
  const net = new THREE.Group();
  for (const m of [lines, points]) { m.frustumCulled = false; net.add(m); }
  lines.renderOrder = 10; points.renderOrder = 11;

  const scene = new THREE.Scene();
  scene.background = o.background.clone();
  scene.add(net);
  const stats: ConstructionStats = { nodos: B.nodes, conexiones: B.links, armadoMs: Math.round(performance.now() - t0) };

  // Duración de cada tramo de T (s): aparición, extrusión y los tres refinamientos (todo malla).
  // Con "reducir movimiento", la malla aparece completa y quieta.
  const SEG = [0.7, 1.2, 0.6, 0.6, 0.6];
  const tAt = (s: number) => {
    let T = 0;
    for (const d of SEG) { if (s <= d) return T + s / d; s -= d; T += 1; }
    return 5 + s; // espera: el pulso usa T − 5
  };
  let raf = 0, start = 0, own = false;
  const loop = (now: number) => {
    if (!own) return;
    shared.uT.value = o.reducedMotion ? 5 : tAt((now - start) / 1000);
    o.controls?.update();
    o.renderer.render(scene, o.camera);
    raf = requestAnimationFrame(loop);
  };

  return {
    stats,
    /** Empieza a dibujar en su propia escena (el visor no dibuja la suya mientras tanto). */
    start() {
      own = true;
      start = performance.now();
      raf = requestAnimationFrame(loop);
    },
    /**
     * Aplica el revelado a los materiales de `root` (terreno, agua, paredes, edificios…): hasta que el frente pase,
     * no se dibujan. Llamarlo antes de precompilar el terreno, para no compilar dos veces.
     */
    patch(root: THREE.Object3D) { revealPatch(root, net); },
    /**
     * El terreno ya está en la escena principal, todavía tapado: los pasos que falten se aceleran (hasta ~0,9 s) y
     * después un frente de borde turbulento (plasma) recorre el suelo desde la base hacia afuera. Por delante, la
     * malla se carga de luz; al pasar, se transforma en el terreno real (línea de luz, tinte que se apaga y
     * destellos sobre el mismo suelo). Nada se dibuja sobre el fondo. `redraw` pide cuadros al visor mientras tanto.
     */
    finish(mainScene: THREE.Scene, redraw: () => void) {
      own = false;
      cancelAnimationFrame(raf);
      revealPatch(mainScene, net); // lo que se agregó después de precompilar (exterior, edificios, marcador…)
      net.position.y = 1.5 * o.k; // apenas sobre el terreno (mismas alturas): sin pelea de profundidad
      mainScene.add(net);
      const T0 = Math.min(shared.uT.value, 5);
      const fill = o.reducedMotion ? 0 : Math.min((5 - T0) * 220, 900);
      const open = o.reducedMotion ? 300 : 1700;
      const total = fill + open;
      // radio final: cubre las esquinas del recorte aun con el borde más hundido (0,8 del radio menos la turbulencia)
      const rMax = (B.span + Math.max(B.top - B.sea + 80 * o.k, 0) * 1.5) / 0.66;
      const t1 = performance.now();
      return new Promise<void>((resolve) => {
        const step = (now: number) => {
          const e = now - t1;
          rv.uRvTime.value = e / 1000;
          if (e < fill) shared.uT.value = T0 + (5 - T0) * (e / fill);
          else {
            shared.uT.value = 5;
            const u = Math.min((e - fill) / open, 1);
            // nace lento desde la base y se acelera al abrirse
            rv.uRvR.value = rMax * (u * u * (3 - 2 * u)) * (0.12 + 0.88 * u);
          }
          redraw();
          if (e < total) requestAnimationFrame(step);
          else {
            rv.uRvOn.value = 0;
            mainScene.remove(net);
            for (const g of [B.edges, B.points, lineMat, pointMat]) g.dispose();
            redraw(); resolve();
          }
        };
        requestAnimationFrame(step);
      });
    },
  };
}
