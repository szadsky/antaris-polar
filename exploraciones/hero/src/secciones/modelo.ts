import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Modelo 3D del hero de las páginas interiores (Noticias: antena parabólica; Investigaciones: estación de
 * comunicaciones). Modelos decorativos del laboratorio: reconstrucción artística, no estructuras reales.
 *
 * - Escaneo al cargar: una línea de luz sube por el propio modelo; debajo queda el modelo sólido y arriba su malla de
 *   alambre, como un escaneo 3D que lo va reconstruyendo. Con «reducir movimiento», aparece directo.
 * - Parallax: rotación leve con el mouse (giro ±0,2 rad e inclinación ±0,05 rad), suavizada.
 * - Fondo transparente: el modelo flota sobre el color de la página; la máscara del contenedor (CSS) funde los bordes.
 * - Se dibuja a pedido: solo mientras escanea o mientras la rotación se está acomodando, y solo en pantalla.
 */
export interface OpcionesModelo {
  url: string;
  /** Giro inicial (rad) para mostrar el mejor lado. */
  giro?: number;
  /** Elevación de la cámara (rad). */
  elevacion?: number;
}

const ESCANEO_S = 2.4;

export function mountModelo(contenedor: HTMLElement, o: OpcionesModelo) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  contenedor.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xe4eef5, 0x8a9aa8, 1.25));
  const sol = new THREE.DirectionalLight(0xfff1df, 2.3);
  sol.position.set(6, 9, 7);
  sol.castShadow = true;
  sol.shadow.mapSize.set(1024, 1024);
  sol.shadow.bias = -0.0004;
  scene.add(sol, sol.target);

  // Piso de nieve: disco blanco que se desvanece hacia afuera (recibe la sombra del modelo).
  const g = document.createElement('canvas'); g.width = g.height = 256;
  const ctx = g.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  // alphaMap lee el canal verde: blanco = opaco, negro = transparente.
  grad.addColorStop(0, '#fff'); grad.addColorStop(0.45, '#fff'); grad.addColorStop(0.75, '#777'); grad.addColorStop(1, '#000');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 256, 256);
  const alfaPiso = new THREE.CanvasTexture(g);
  const piso = new THREE.Mesh(new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({ color: 0xf3f7fa, roughness: 0.95, transparent: true, alphaMap: alfaPiso, depthWrite: false }));
  piso.rotation.x = -Math.PI / 2;
  piso.receiveShadow = true;
  scene.add(piso);

  const pivote = new THREE.Group();
  scene.add(pivote);

  // Escaneo: uniforms compartidos por el modelo sólido y su malla de alambre (sin disco ni plano de luz: pedido del usuario).
  const u = { uScanY: { value: -1e6 }, uBanda: { value: 0.12 }, uScanOn: { value: 1 } };
  const parcheSolido = (m: THREE.Material) => {
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nuniform float uScanY, uBanda, uScanOn;')
        .replace('void main() {', 'void main() {\n  if (uScanOn > 0.5 && vWorldY > uScanY) discard;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (uScanOn > 0.5) { float b = 1.0 - smoothstep(0.0, uBanda, uScanY - vWorldY); totalEmissiveRadiance += vec3(0.45, 0.9, 1.0) * b * 2.2; }`);
    };
    m.needsUpdate = true;
  };
  const alambre = new THREE.MeshBasicMaterial({ color: 0x5fcdf0, wireframe: true, transparent: true, opacity: 0.32, depthWrite: false });
  alambre.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWorldY;\nuniform float uScanY, uBanda, uScanOn;')
      .replace('void main() {', 'void main() {\n  if (vWorldY < uScanY) discard;');
  };

  // Tamaño y encuadre
  let alturaModelo = 1, radio = 1;
  const resize = () => {
    const w = contenedor.clientWidth, h = contenedor.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const elev = o.elevacion ?? 0.24;
    const dist = (radio * 0.78) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect);
    camera.position.set(0, alturaModelo * 0.45 + Math.sin(elev) * dist, Math.cos(elev) * dist);
    camera.lookAt(0, alturaModelo * 0.42, 0);
    camera.updateProjectionMatrix();
    pedir();
  };

  // Parallax con el mouse
  const objetivo = new THREE.Vector2(), actual = new THREE.Vector2();
  if (!reduce) window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !(innerWidth > 0 && innerHeight > 0)) return;
    objetivo.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    pedir();
  }, { passive: true });

  // Bucle a pedido
  let visible = true, corriendo = false, escaneo = reduce ? 1 : 0, cargado = false, ultimo = 0;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) pedir(); }).observe(contenedor);
  const giro0 = o.giro ?? 0;
  const cuadro = (t: number) => {
    const dt = Math.min((t - (ultimo || t)) / 1000, 0.05); ultimo = t;
    let sigue = false;
    if (cargado && escaneo < 1) {
      aplicarEscaneo(Math.min(1, escaneo + dt / ESCANEO_S));
      sigue = true;
    }
    const k = 1 - Math.exp(-dt * 4);
    actual.x += (objetivo.x - actual.x) * k;
    actual.y += (objetivo.y - actual.y) * k;
    pivote.rotation.y = giro0 + actual.x * 0.2;
    pivote.rotation.x = actual.y * 0.05;
    if (Math.abs(objetivo.x - actual.x) + Math.abs(objetivo.y - actual.y) > 0.001) sigue = true;
    renderer.render(scene, camera);
    if (sigue && visible) requestAnimationFrame(cuadro); else { corriendo = false; ultimo = 0; }
  };
  function pedir() {
    if (corriendo || !visible) return;
    corriendo = true;
    requestAnimationFrame(cuadro);
  }
  /** Progreso del escaneo (0…1): la línea sube con ease-in-out y deja el modelo sólido debajo. */
  function aplicarEscaneo(p: number) {
    escaneo = p;
    const e = p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
    u.uScanY.value = -0.05 * alturaModelo + e * alturaModelo * 1.12;
    if (p >= 1) terminarEscaneo();
  }
  // Solo desarrollo: fija el progreso del escaneo y dibuja (capturas, aun con la pestaña oculta).
  if (import.meta.env.DEV) (window as unknown as { __modeloEscaneo: (p: number) => void }).__modeloEscaneo = (p) => {
    if (cargado && u.uScanOn.value > 0.5) aplicarEscaneo(Math.max(0, Math.min(1, p)));
    renderer.render(scene, camera);
  };
  let alambreMesh: THREE.Mesh | null = null;
  function terminarEscaneo() {
    u.uScanOn.value = 0;
    if (alambreMesh) { alambreMesh.parent?.remove(alambreMesh); alambre.dispose(); alambreMesh = null; }
    contenedor.dataset.state = 'listo';
  }

  contenedor.dataset.state = 'cargando';
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.loadAsync(o.url).then((gltf) => {
    const modelo = gltf.scene;
    // Altura normalizada a 4 unidades, apoyado en el piso y centrado
    const caja = new THREE.Box3().setFromObject(modelo);
    const s = 4 / Math.max(1e-6, caja.max.y - caja.min.y);
    modelo.scale.setScalar(s);
    caja.setFromObject(modelo);
    const centro = caja.getCenter(new THREE.Vector3());
    modelo.position.set(-centro.x, -caja.min.y, -centro.z);
    caja.setFromObject(modelo);
    alturaModelo = caja.max.y;
    radio = caja.getBoundingSphere(new THREE.Sphere()).radius;
    piso.scale.setScalar(radio * 0.95);
    sol.shadow.camera.left = sol.shadow.camera.bottom = -radio * 1.4;
    sol.shadow.camera.right = sol.shadow.camera.top = radio * 1.4;
    sol.shadow.camera.far = 60;
    sol.shadow.camera.updateProjectionMatrix();
    modelo.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      if (!reduce) {
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) parcheSolido(mat);
        const w = new THREE.Mesh(m.geometry, alambre);
        w.position.copy(m.position); w.quaternion.copy(m.quaternion); w.scale.copy(m.scale);
        m.parent?.add(w);
        alambreMesh = w;
      }
    });
    pivote.add(modelo);
    cargado = true;
    if (reduce) terminarEscaneo(); else u.uScanY.value = -0.05 * alturaModelo;
    resize();
    pedir();
  }).catch((err) => {
    contenedor.dataset.state = 'error';
    console.error('Modelo 3D:', err);
  });

  new ResizeObserver(resize).observe(contenedor);
  resize();
  return { dispose() { renderer.dispose(); } };
}
