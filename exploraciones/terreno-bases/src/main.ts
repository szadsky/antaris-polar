import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { TerrainLoader, type Terrain, type TerrainLevel, type TerrainMeta } from "./terrain";
import { Metrics } from "./metrics";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const statusEl = $("status");
const sourceEl = $("source");
const metricsEl = $("metrics");
const exaggerationEl = $<HTMLSelectElement>("exaggeration");
const titleEl = $("title");
const backEl = $<HTMLAnchorElement>("back");
const pinEl = $("pin");

function showStatus(msg: string) {
  statusEl.hidden = false;
  statusEl.textContent = msg;
}

main().catch((err) => {
  console.error(err);
  showStatus(`No se pudo cargar el terreno: ${err instanceof Error ? err.message : String(err)}`);
});

async function main() {
  if (!document.createElement("canvas").getContext("webgl2")) {
    showStatus("Este navegador no soporta WebGL 2. El terreno 3D no está disponible en este dispositivo.");
    return;
  }
  if (typeof DecompressionStream === "undefined") {
    showStatus("Este navegador es demasiado antiguo para descomprimir el terreno. Actualizalo para ver la vista 3D.");
    return;
  }

  // ─── Datos ──────────────────────────────────────────────
  const baseId = (new URLSearchParams(location.search).get("base") ?? "carlini").replace(/[^a-z0-9-]/g, "");
  const dir = `/terrain/${baseId}`;
  backEl.href = `./bases.html#${baseId}`;
  const metaRes = await fetch(`${dir}/terrain.json`);
  if (!metaRes.ok) {
    showStatus(`Todavía no hay terreno REMA procesado para "${baseId}". Volvé al mapa de bases para elegir otra.`);
    return;
  }
  const meta: TerrainMeta = await metaRes.json();
  if (meta.base) {
    titleEl.textContent = `${meta.base.nombre} · REMA`;
    document.title = `${meta.base.nombre} · Terreno 3D · Antaris Polar`;
  }
  const plan = levelPlan(meta.levels);

  // ─── Escena ─────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const first = meta.levels.find((l) => l === plan[0])!;
  const widthM = (first.width - 1) * first.cellSizeM;
  const depthM = (first.height - 1) * first.cellSizeM;
  const size = Math.max(widthM, depthM);

  const sky = new THREE.Color("#9fb6c6");
  const scene = new THREE.Scene();
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, size * 0.9, size * 2.6);
  scene.add(new THREE.HemisphereLight("#dfeaf2", "#3b4650", 1.1));
  // Sol bajo, típico de latitudes altas.
  const sun = new THREE.DirectionalLight("#fff3e2", 2.2);
  sun.position.set(-0.6, 0.35, -1).multiplyScalar(size);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 5, size * 6);
  const controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
  controls.minDistance = 60;
  controls.maxDistance = size * 2.2;
  controls.keyPanSpeed = 20;
  controls.listenToKeyEvents(window);

  // ─── Render a demanda: solo se dibuja si algo cambió ────
  const metrics = new Metrics(renderer);
  const v = new THREE.Vector3();
  let pin: ReturnType<typeof buildPin> = null;
  let dirty = true;
  let running = false;
  let idleFrames = 0;

  const frame = () => {
    const moved = controls.update(); // true mientras hay movimiento o inercia
    if (!moved && !dirty) {
      // Unos cuadros de margen y se apaga el bucle: cero trabajo en reposo.
      if (++idleFrames > 5) {
        renderer.setAnimationLoop(null);
        running = false;
        metrics.idle();
        metricsEl.textContent = metrics.format();
      }
      return;
    }
    idleFrames = 0;
    dirty = false;
    renderer.render(scene, camera);
    if (pin) {
      v.copy(pin.top).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      pinEl.style.opacity = visible ? "1" : "0";
      pinEl.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -130%)`;
    }
    if (metrics.tick()) metricsEl.textContent = metrics.format();
  };
  const requestRender = () => {
    dirty = true;
    if (!running) {
      running = true;
      metrics.wake();
      renderer.setAnimationLoop(frame);
    }
  };
  controls.addEventListener("change", requestRender);
  controls.addEventListener("start", requestRender);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    requestRender();
  });

  // ─── Terreno: carga progresiva (liviano primero, detallado después) ───
  const loader = new TerrainLoader();
  let terrain: Terrain | null = null;
  let exaggeration = Number(exaggerationEl.value);
  const tStart = performance.now();

  const show = (t: Terrain) => {
    if (terrain) {
      scene.remove(terrain.mesh);
      terrain.dispose();
    }
    if (pin) scene.remove(pin.group);
    terrain = t;
    scene.add(t.mesh);
    pin = buildPin(meta, t, size);
    if (pin) {
      pin.setExaggeration(exaggeration);
      scene.add(pin.group);
      pinEl.textContent = meta.base?.nombre.replace(/^Base (Antártica )?/, "Base ") ?? "";
      pinEl.hidden = false;
    }
    sourceEl.textContent = describeSource(meta, t.level);
    requestRender();
  };

  // La interfaz responde desde el principio, también mientras carga el detallado.
  wireUi(metrics, async (k) => {
    exaggeration = k;
    const t = terrain;
    if (!t) return;
    await t.setExaggeration(k); // en el worker: no traba la página
    if (terrain !== t) return; // se reemplazó por el detallado mientras tanto
    pin?.setExaggeration(k);
    requestRender();
  });
  // Acceso para depuración desde la consola.
  Object.assign(window, {
    __terreno: { scene, camera, controls, renderer, metrics, meta, requestRender, get terrain() { return terrain; } },
  });

  const firstTerrain = await loader.load(dir, meta, plan[0], exaggeration);
  show(firstTerrain);
  const firstViewMs = performance.now() - tStart;
  // `pin` se asigna dentro de show(); TS no sigue esa asignación.
  const firstPin = pin as ReturnType<typeof buildPin>;
  controls.target.set(firstPin?.local.x ?? 0, 0, firstPin?.local.z ?? 0);
  camera.position.set(controls.target.x, size * 0.42, controls.target.z + size * 0.72);
  controls.update();
  statusEl.hidden = true;
  metrics.load = loadInfo(firstTerrain, firstViewMs, null);
  requestRender();

  if (plan[1]) {
    // El detallado se descarga y arma en segundo plano; la vista ya es navegable.
    const k = exaggeration;
    const detailed = await loader.load(dir, meta, plan[1], k);
    if (exaggeration !== k) await detailed.setExaggeration(exaggeration); // cambió mientras cargaba
    show(detailed);
    metrics.load = loadInfo(detailed, firstViewMs, performance.now() - tStart);
  }
}

function wireUi(
  metrics: Metrics,
  onExaggeration: (k: number) => void
) {
  exaggerationEl.addEventListener("change", () => onExaggeration(Number(exaggerationEl.value)));
  $("copy-metrics").addEventListener("click", async () => {
    const json = JSON.stringify(metrics.snapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $("copy-metrics").textContent = "Copiado";
    } catch {
      console.log(json);
      $("copy-metrics").textContent = "Ver consola";
    }
    setTimeout(() => ($("copy-metrics").textContent = "Copiar métricas"), 1500);
  });
}

function loadInfo(t: Terrain, firstViewMs: number, fullMs: number | null) {
  return {
    level: `${t.level.width}×${t.level.height} · ${t.level.cellSizeM.toFixed(1)} m`,
    bytes: t.level.transferBytes ?? t.level.bytes,
    transferBytes: t.ms.transferBytes || null,
    fetchMs: t.ms.fetch,
    buildMs: t.ms.decode + t.ms.mesh,
    firstViewMs,
    fullMs,
  };
}

/**
 * Niveles a cargar, en orden. ?res=512 o ?res=1024 fuerza uno solo.
 * Pantallas táctiles o chicas: solo el liviano. Resto: liviano y luego detallado.
 */
function levelPlan(levels: TerrainLevel[]): TerrainLevel[] {
  const sorted = [...levels].sort((a, b) => a.width - b.width);
  const forced = new URLSearchParams(location.search).get("res");
  if (forced) {
    const match = sorted.find((l) => l.file.includes(`-${forced}.`));
    if (match) return [match];
  }
  const constrained = matchMedia("(pointer: coarse)").matches || innerWidth < 800;
  return constrained || sorted.length === 1 ? [sorted[0]] : [sorted[0], sorted[sorted.length - 1]];
}

/**
 * Marcador vertical en la coordenada COMNAP de la base. La malla está centrada
 * en el recorte; el vértice (0,0) corresponde al centro del primer bloque.
 */
function buildPin(meta: TerrainMeta, terrain: Terrain, size: number) {
  if (!meta.base) return null;
  const level = terrain.level;
  const [X, Y] = meta.base.projected;
  const [ox, oy] = meta.original.originProjected;
  const cell = level.cellSizeM;
  const col = (X - ox) / cell - 0.5;
  const row = (oy - Y) / cell - 0.5;
  if (col < 0 || row < 0 || col > level.width - 1 || row > level.height - 1) return null;
  const local = new THREE.Vector3(col * cell - terrain.widthM / 2, 0, row * cell - terrain.depthM / 2);
  const ground = terrain.heightsM[Math.round(row) * level.width + Math.round(col)];
  const groundM = Number.isNaN(ground) ? 0 : ground;
  const stem = size * 0.03;

  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: "#74acdf" });
  const line = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.0012, size * 0.0012, stem, 8), mat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(size * 0.005, 16, 12), mat);
  group.add(line, head);
  const top = new THREE.Vector3();

  function setExaggeration(k: number) {
    const y = groundM * k;
    group.position.set(local.x, y, local.z);
    line.position.y = stem / 2;
    head.position.y = stem;
    top.set(local.x, y + stem, local.z);
  }
  setExaggeration(1);
  return { group, local, top, setExaggeration };
}

function describeSource(meta: TerrainMeta, level: TerrainLevel) {
  const p = meta.provenance as Record<string, unknown> | null;
  const dataset = (p?.dataset as string) ?? (p?.datasetName as string) ?? "REMA";
  const parts = [
    `Datos: ${dataset}`,
    `${meta.original.resolutionM[0]} m/px original, ${level.cellSizeM.toFixed(0)} m en este nivel`,
    meta.geoid
      ? `Alturas ≈ ${(meta.heights.minM - meta.geoid.egm2008).toFixed(0)}–${(meta.heights.maxM - meta.geoid.egm2008).toFixed(
          0
        )} m s. n. m. (elipsoidal − geoide EGM2008 ${meta.geoid.egm2008.toFixed(1)} m)`
      : `Alturas ${meta.heights.minM.toFixed(0)}–${meta.heights.maxM.toFixed(0)} m (${meta.heights.verticalReference})`,
  ];
  if (meta.base) parts.push(`Marcador: coordenada COMNAP de la base`);
  if (meta.original.nodataPercent > 0) parts.push(`${meta.original.nodataPercent.toFixed(1)} % sin dato (no se dibuja)`);
  parts.push(
    meta.coastline
      ? `Costa: ${meta.coastline.label}; el mar no es medición de REMA`
      : "Sin costa: mar y tierra no se distinguen"
  );
  return parts.join(" · ");
}
