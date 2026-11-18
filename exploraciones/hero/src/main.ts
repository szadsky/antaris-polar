import { mountWeather } from './weather';
mountWeather();
import { mountDeviceParallax } from './device-parallax';
import { mountJourney } from './journey';
mountJourney();
import { mountSiteNav } from '../../../compartido/navbar/navbar';
mountSiteNav({ actual: 'inicio' }).classList.add('home-nav'); // navegación entre sitios: no depende de WebGL

import { mountIslas } from './islas';
mountIslas(); // última sección: las islas del pingüino, con carga diferida
import * as THREE from 'three';
import { CAM_H, IMG, PITCH, VFOV_DEG, ray } from './camara';
import { createBackdrop } from './backdrop';
import { createWater, type WaterRows } from './water';
import { createTerrain, loadMasks } from './terrain';
import { createPenguin } from './penguin';
import { createGrass } from './grass';
import { createFrost } from './frost';
import { loadTerrainTextures } from './snow/terrain-textures';

/**
 * Hero de Antaris Polar. Una sola escena Three.js vista con la cámara de la referencia:
 *  - fondo pintado (cielo, cumbres y laderas del zip) con parallax por profundidad (Depth Anything V2);
 *  - barcos pintados parados sobre el agua; el agua (shader) los refleja de verdad;
 *  - loma de nieve y roca en 3D con el material del visor, y el pingüino del laboratorio.
 * Con la cámara en reposo el cuadro reproduce el encuadre de la referencia (1672 × 941). El mouse (o el dedo, o el
 * scroll) la mueve unos centímetros: parallax real entre capas. Con «reducir movimiento», la cámara queda quieta.
 */
const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL + 'hero/';
const canvas = document.getElementById('hero-canvas') as HTMLCanvasElement;
const hero = document.getElementById('hero') as HTMLElement;
const statusEl = document.getElementById('hero-status');
const perfEl = document.getElementById('hero-perf');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)').matches;

// Movimiento de la cámara (m): lateral, vertical y subida con el scroll. Mira siempre al mismo punto a 40 m.
const MOVE = { x: 0.22, y: 0.08, scroll: 0.6 };
const PIVOT_M = 40;
// Parallax por profundidad dentro de cumbres y laderas (px de la referencia por unidad de movimiento).
// Desplazamiento máximo de la malla elástica (px de la referencia). Las cumbres usan todo el rango (hasta 34 × 10 px en
// sus faldas, 0 en los picos); las laderas, 0,2–0,4 (7–14 px, casi en bloque). Ajustes por capa: DEPTH_DEFAULTS y el panel.
const DEPTH_PARALLAX_PX = new THREE.Vector2(34, 10);

function webglAvailable() {
  if (params.has('sinwebgl')) return false; // prueba de la alternativa sin WebGL
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}

async function start() {
  if (!webglAvailable()) { hero.dataset.state = 'estatico'; statusEl && (statusEl.textContent = 'Vista estática: este navegador no tiene WebGL 2.'); return; }
  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const fixedDpr = Number(params.get('dpr'));
  let dpr = fixedDpr || Math.min(devicePixelRatio, coarse ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9bb7d9');
  const camera = new THREE.PerspectiveCamera(VFOV_DEG, IMG.w / IMG.h, 0.3, 40000);
  const basePos = new THREE.Vector3(0, CAM_H, 0);
  const center = ray(IMG.w / 2, IMG.h / 2);
  const pivot = new THREE.Vector3(center[0], center[1], center[2]).multiplyScalar(PIVOT_M / -center[2]).add(basePos);
  camera.position.copy(basePos);
  camera.rotation.set(PITCH, 0, 0);
  camera.updateMatrixWorld();

  // Cámara de referencia (sin desplazamiento ni recorte): el agua la usa para tomar el color de cada fila.
  const refCam = camera.clone();
  refCam.updateProjectionMatrix(); refCam.updateMatrixWorld();
  const refViewProj = new THREE.Matrix4().multiplyMatrices(refCam.projectionMatrix, refCam.matrixWorldInverse);

  // Luz: sol bajo desde la izquierda y algo detrás de la escena (sombra del pingüino hacia adelante y a la derecha,
  // como en la referencia), cálido; cielo azulado.
  const SUN = new THREE.Vector3(...((new URLSearchParams(location.search).get('sol') ?? '-0.7,0.62,-0.36').split(',').map(Number) as [number, number, number])).normalize();
  // Valores ajustados comparando el color medio de la loma con la referencia (scripts/medias.mjs).
  scene.add(new THREE.HemisphereLight('#a8c4ff', '#6f7f99', 0.85));
  const sun = new THREE.DirectionalLight('#ffe2bd', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 40 });
  sun.shadow.normalBias = 0.02; sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target);

  const [scenePrep, rows, textures] = await Promise.all([
    fetch(BASE + 'escena.json').then((r) => r.json() as Promise<{ base: { pies: [number, number]; mascaraFilas: [number, number] } }>),
    fetch(BASE + 'agua-filas.json').then((r) => r.json() as Promise<WaterRows>),
    loadTerrainTextures(renderer, renderer.capabilities.getMaxAnisotropy()),
  ]);
  const [backdrop, masks, penguin] = await Promise.all([
    createBackdrop(BASE),
    loadMasks(BASE + 'base-mascaras.webp', scenePrep.base.mascaraFilas[0]),
    createPenguin(import.meta.env.BASE_URL + 'assets/models/pinguino-hero.glb'),
  ]);
  // Loma generada (heightfield con el material de nieve del visor): src/terrain.ts.
  const base = createTerrain(masks, SUN);
  const grass = await createGrass(BASE, base.groundAt);
  scene.add(backdrop.group, base.mesh, grass.mesh, penguin.group);

  // Pingüino parado donde la referencia pone sus pies, de espaldas (mira hacia −z) y con la cabeza a la derecha.
  const feet = base.groundAt(...scenePrep.base.pies);
  penguin.group.position.copy(feet);
  penguin.group.rotation.y = Math.PI;
  penguin.headYaw = -1.15;
  sun.target.position.copy(feet);
  sun.position.copy(feet).addScaledVector(SUN, 20);

  const water = createWater({ rows, refViewProj, imageH: IMG.h, mobile: coarse, sun: SUN, mirrorHide: [...backdrop.group.children.filter((c) => c.name !== 'barcos'), base.mesh, grass.mesh, penguin.group] });
  scene.add(water.mesh);

  // ── Encuadre: «cover» de la imagen de referencia, con recorte centrado en el pingüino en pantallas angostas ──
  let vw = 0, vh = 0;
  const resize = () => {
    // Con el hero en 0 px (pestaña o panel oculto, cambio de tamaño en curso) no hay encuadre posible: se espera al siguiente.
    if (hero.clientWidth === 0 || hero.clientHeight === 0) return;
    vw = hero.clientWidth; vh = hero.clientHeight;
    renderer.setSize(vw, vh, false);
    const s = Math.max(vw / IMG.w, vh / IMG.h), fw = IMG.w * s, fh = IMG.h * s;
    const focusX = vw / vh < IMG.w / IMG.h ? feet ? 822 : IMG.w / 2 : IMG.w / 2;
    const ox = Math.min(Math.max(focusX * s - vw / 2, 0), fw - vw), oy = (fh - vh) / 2;
    camera.setViewOffset(fw, fh, ox, oy, vw, vh);
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(hero);

  // ── Movimiento: puntero (escritorio), arrastre (táctil), scroll; nada con «reducir movimiento» ────────────────
  const target = new THREE.Vector2(), current = new THREE.Vector2();
  const deviceParallax=mountDeviceParallax(hero,(x,y)=>target.set(x,y),reducedMotion);
  let scrollT = 0, scrollCur = 0;
  let animate = false; // «Animar» del panel: recorre el rango solo (para ajustar sin mover el mouse)
  const still = () => !animate && (reducedMotion.matches || params.has('quieto'));
  window.addEventListener('pointermove', (e) => {
    if (deviceParallax.active() || (e.pointerType === 'touch' && e.buttons === 0)) return;
    // Con la ventana en 0 px la división daba infinito y la cámara quedaba en NaN para siempre (no se movía más).
    if (!(innerWidth > 0 && innerHeight > 0)) return;
    const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));
    target.set(clamp1((e.clientX / innerWidth) * 2 - 1), clamp1((e.clientY / innerHeight) * 2 - 1));
  }, { passive: true });
  document.addEventListener('pointerleave', () => {if(!deviceParallax.active())target.set(0, 0);});
  // Transición (src/frost.ts): el hero queda fijo dentro de #hero-track; el avance por ese tramo (0…1) es el progreso
  // de la escarcha y también sube un poco la cámara.
  const track = document.getElementById('hero-track') ?? hero;
  let frostT = 0, frostCur = 0;
  let frostFijo: number | null = null; // solo desarrollo: __heroFrost(p) fija el progreso sin scrollear (capturas)
  const onScroll = () => {
    const span = Math.max(1, (track.offsetHeight - innerHeight) * 0.8);
    frostT = frostFijo ?? Math.min(1, Math.max(0, -track.getBoundingClientRect().top / span));
    scrollT = frostT;
  };
  window.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('resize', onScroll); onScroll();
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') target.set(0, 0); });

  const frost = createFrost(renderer);
  // La transición termina en el fondo de la sección de abajo: el primero no transparente desde #contenido hacia arriba
  // (hoy el de <body>, var(--paper)). Se lee de la página, no está fijo en el código.
  const leerColorSeccion = () => {
    for (let el: Element | null = document.getElementById('contenido'); el; el = el.parentElement) {
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (a > 0) { frost.setColor(r / 255, g / 255, b / 255); return; }
    }
  };
  leerColorSeccion();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', leerColorSeccion);
  // Los textos se apagan cuando el frente (sin su ruido) llega a la esquina más expuesta de cada uno; sus velos con ellos.
  const copyEls = [...hero.querySelectorAll<HTMLElement>('.hero-copy > h1, .hero-lead, .hero-coords, .hero-explore, .hero-note')];
  let copyReach: number[] = [];
  const superS = (x: number, y: number) => Math.pow(Math.abs(x) ** 6 + Math.abs(y) ** 6, 1 / 6);
  const measureCopy = () => {
    const h = hero.getBoundingClientRect();
    if (!h.width || !h.height) return;
    copyReach = copyEls.map((el) => {
      const b = el.getBoundingClientRect();
      const xs = [b.left, b.right].map((v) => ((v - h.left) / h.width) * 2 - 1);
      const ys = [b.top, b.bottom].map((v) => ((v - h.top) / h.height) * 2 - 1);
      return Math.max(...xs.flatMap((x) => ys.map((y) => superS(x, y))));
    });
  };
  new ResizeObserver(measureCopy).observe(hero);
  void document.fonts?.ready.then(measureCopy);
  let lastFade = -1;
  const fadeCopy = (p: number) => {
    if (Math.abs(p - lastFade) < 0.002) return;
    lastFade = p;
    const e = frost.edgeAt(p);
    const sm = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    // En reposo (p = 0) todo visible; con el primer scroll, cada texto se apaga cuando el frente llega a su esquina.
    const op = copyReach.map((sMax) => 1 - sm(0, 0.04, p) * sm(-0.06, 0.06, sMax - e));
    copyEls.forEach((el, i) => { el.style.opacity = String(op[i] ?? 1); });
    // El velo del título es más ancho que el título: se apaga antes, para no ensuciar de gris lo ya cubierto.
    hero.style.setProperty('--velo-titulo', String(Math.min(op[0] ?? 1, 1 - sm(0.06, 0.28, p))));
    hero.style.setProperty('--velo-pie', String(Math.min(op[1] ?? 1, op[2] ?? 1)));
  };

  // ── Bucle ──────────────────────────────────────────────────────────────────────────────────────────────
  const clock = new THREE.Clock();
  const frames: number[] = [];
  let visible = true, last = performance.now(), firstFrame = true, sinceAdapt = 0;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
  const tmp = new THREE.Vector3();
  /** Cámara desde el desplazamiento suavizado (current: −1…1 por eje) y el scroll (0…1). */
  const applyCamera = () => {
    camera.position.set(basePos.x + current.x * MOVE.x, basePos.y - current.y * MOVE.y + scrollCur * MOVE.scroll, basePos.z);
    camera.lookAt(pivot.x, pivot.y + scrollCur * MOVE.scroll * 0.4, pivot.z);
    backdrop.parallax.value.set(-current.x * DEPTH_PARALLAX_PX.x, current.y * DEPTH_PARALLAX_PX.y);
  };
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden) { clock.getDelta(); return; }
    const now = performance.now(); frames.push(now - last); last = now; if (frames.length > 240) frames.shift();
    // Calidad adaptativa: si la mediana de los últimos 120 cuadros pasa de 22 ms, baja la resolución interna
    // (0,25 por paso, hasta 0,75). No actúa con ?dpr= fijo (capturas y mediciones).
    if (!fixedDpr && frames.length >= 120 && ++sinceAdapt >= 120) {
      sinceAdapt = 0;
      const recent = frames.slice(-120).sort((a, b) => a - b)[60];
      if (recent > 22 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); renderer.setPixelRatio(dpr); resize(); frames.length = 0; }
    }
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (still()) { current.set(0, 0); scrollCur = 0; frostCur = frostT; }
    else {
      // en táctil sin arrastre: deriva lenta (alternativa al mouse)
      const drift = animate ? tmp.set(Math.sin(t * 0.9), Math.sin(t * 0.55) * 0.8, 0)
        : coarse && !deviceParallax.active() && target.lengthSq() === 0 ? tmp.set(Math.sin(t * 0.21) * 0.6, Math.sin(t * 0.13) * 0.3, 0) : null;
      const k = 1 - Math.exp(-dt * 3.2);
      current.x += ((drift ? drift.x : target.x) - current.x) * k;
      current.y += ((drift ? drift.y : target.y) - current.y) * k;
      scrollCur += (scrollT - scrollCur) * (1 - Math.exp(-dt * 6));
      frostCur += (frostT - frostCur) * (1 - Math.exp(-dt * 8));
      if (Math.abs(frostT - frostCur) < 1e-4) frostCur = frostT;
      // Red de seguridad: un valor no finito se arrastraría a todos los cuadros siguientes.
      if (!Number.isFinite(current.x) || !Number.isFinite(current.y)) { current.set(0, 0); target.set(0, 0); }
      if (!Number.isFinite(scrollCur)) scrollCur = 0;
    }
    applyCamera();
    if (!still()) { penguin.update(dt); water.time(t); }
    else if (firstFrame) { penguin.update(0); }
    renderer.render(scene, camera);
    // Máscara de transición sobre el cuadro (nada con progreso 0). Con «reducir movimiento» sigue al scroll, quieta.
    frost.render(frostCur, still() ? 0 : t);
    fadeCopy(frostCur);
    if (firstFrame) {
      firstFrame = false;
      hero.dataset.state = 'listo';
      const ms = Math.round(performance.now() - t0);
      (window as unknown as { __hero: unknown }).__hero = { readyMs: ms };
      statusEl && (statusEl.textContent = '');
    }
  });

  // Medición (?medir): mediana y p95 del tiempo por cuadro, triángulos y draw calls.
  const stats = () => {
    const s = [...frames].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
    return { fps: s.length ? Math.round(1000 / q(0.5)) : 0, medianaMs: +q(0.5).toFixed(2), p95Ms: +q(0.95).toFixed(2),
      dpr, viewport: [vw, vh], loma: base.triangles, lomaGeneracion: base.timings, barcosM: backdrop.boatDistances, agua: water.stats(), texturas: textures };
  };
  (window as unknown as { __heroStats: typeof stats }).__heroStats = stats;
  /**
   * Costo por cuadro medido de forma sincrónica (render + gl.finish), con la cámara recorriendo todo su rango y el agua
   * animada: no depende de que la pestaña esté visible ni del límite de refresco de la pantalla. Mide CPU + GPU de
   * este equipo; no reemplaza una medición de FPS en un celular real.
   */
  const px = new Uint8Array(4);
  // readPixels de 1 píxel obliga a esperar a la GPU (gl.finish no bloquea en Chrome/ANGLE)
  const sync = () => { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  /** Llamadas de dibujo y triángulos de un cuadro completo (reflejo + escena + sombra): sin reinicio entre pases. */
  const frameCost = () => {
    renderer.info.autoReset = false; renderer.info.reset();
    renderer.render(scene, camera);
    const r = { drawCalls: renderer.info.render.calls, triangulos: renderer.info.render.triangles };
    renderer.info.autoReset = true;
    return r;
  };
  const bench = (n = 240) => {
    const gl = renderer.getContext(), ms: number[] = [], saved = current.clone();
    renderer.render(scene, camera); sync(); // calentamiento
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      current.set(Math.sin(a), Math.sin(a * 2) * 0.8); applyCamera(); water.time(i / 60); penguin.update(1 / 60);
      const t1 = performance.now(); renderer.render(scene, camera); sync(); ms.push(performance.now() - t1);
    }
    current.copy(saved); applyCamera();
    ms.sort((a, b) => a - b);
    const q = (p: number) => +ms[Math.min(n - 1, Math.floor(n * p))].toFixed(2);
    return { cuadros: n, medianaMs: q(0.5), p95Ms: q(0.95), maxMs: q(1), ...frameCost(), dpr, viewport: [vw, vh], gpu: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'sin dato'; })() };
  };
  if (import.meta.env.DEV || params.has('medir')) Object.assign(window, { __heroBench: bench });
  if (import.meta.env.DEV) Object.assign(window, {
    __heroDebug: { scene, camera, renderer, base, water, backdrop, penguin, grass, frost },
    // Captura del canvas (mismo cuadro, sin interfaz) que el servidor de desarrollo guarda en capturas/<nombre>.png.
    // Pose fija de la cámara (x, y: −1…1; scroll: 0…1) para capturar el parallax sin depender del bucle.
    // Fija el progreso y dibuja un cuadro en el momento (sirve aunque la pestaña esté oculta y el bucle en pausa).
    __heroFrost: (p: number | null) => {
      frostFijo = p; onScroll(); frostCur = frostT; scrollCur = scrollT;
      applyCamera(); renderer.render(scene, camera); frost.render(frostCur, 0); fadeCopy(frostCur);
    },
    __heroPose: (x: number, y: number, scroll = 0) => { current.set(x, y); scrollCur = scroll; applyCamera(); renderer.render(scene, camera); },
    __heroCapture: (nombre: string) => { penguin.update(0); renderer.render(scene, camera); const png = canvas.toDataURL('image/png'); return fetch('/__captura?nombre=' + encodeURIComponent(nombre), { method: 'POST', body: png }).then((r) => r.text()); },
  });
  if (params.has('medir') && perfEl) { perfEl.hidden = false; setInterval(() => { const s = stats(); perfEl.textContent = `${s.fps} FPS · ${s.medianaMs} ms por cuadro (p95 ${s.p95Ms})`; }, 500); }

  // Panel de profundidad: solo con ?panel; oculto en la home normal y en capturas.
  // Importación dinámica: DialKit (~40 KB gzip) solo se descarga cuando se muestra el panel.
  let panel: { destroy(): void } | null = null;
  // La vista pública y el desarrollo arrancan sin parámetros visibles.
  if (params.has('panel') && !params.has('limpio') && !params.has('referencia')) {
    import('./panel').then(({ mountDepthPanel }) => {
      panel = mountDepthPanel({
        motion: { horizontal: DEPTH_PARALLAX_PX.x, vertical: DEPTH_PARALLAX_PX.y, camaraX: MOVE.x, camaraY: MOVE.y, animar: false },
        onLayer: (name, v) => backdrop.setDepth(name, v),
        onMotion: (m) => { DEPTH_PARALLAX_PX.set(m.horizontal, m.vertical); MOVE.x = m.camaraX; MOVE.y = m.camaraY; animate = m.animar; },
      });
    }).catch((err) => console.error('Panel de profundidad:', err));
  }
  window.addEventListener('pagehide', () => { deviceParallax.dispose(); panel?.destroy(); renderer.setAnimationLoop(null); backdrop.dispose(); base.dispose(); grass.dispose(); penguin.dispose(); water.dispose(); frost.dispose(); renderer.dispose(); }, { once: true });
}

start().catch((err) => {
  console.error(err);
  hero.dataset.state = 'estatico';
  if (statusEl) statusEl.textContent = 'No se pudo iniciar la escena 3D; se muestra la imagen fija.';
});
