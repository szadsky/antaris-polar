import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { MESH_STRIDE, TerrainLoader, type Level, type Terrain, type TerrainMeta } from "./terrain";
import { Metrics } from "./metrics";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const statusEl = $("status");
const pinEl = $("pin");
const baseEl = $<HTMLSelectElement>("base");
const exaggerationEl = $<HTMLSelectElement>("exaggeration");
const beforeBtn = $<HTMLButtonElement>("mode-before");
const afterBtn = $<HTMLButtonElement>("mode-after");
const noteEl = $("mode-note");
const sourceEl = $("source");
const metricsEl = $("metrics");

const showStatus = (msg: string) => ((statusEl.hidden = false), (statusEl.textContent = msg));

main().catch((err) => {
  console.error(err);
  showStatus(`No se pudo cargar el terreno: ${err instanceof Error ? err.message : String(err)}`);
});

async function main() {
  if (!document.createElement("canvas").getContext("webgl2")) return showStatus("Este navegador no soporta WebGL 2.");
  if (typeof DecompressionStream === "undefined") return showStatus("Este navegador es demasiado antiguo para descomprimir el terreno.");

  const params = new URLSearchParams(location.search);
  const index: { bases: { id: string; nombre: string; permanente: boolean }[] } = await (await fetch("/terreno/index.json")).json();
  const baseId = (params.get("base") ?? "carlini").replace(/[^a-z0-9-]/g, "");
  for (const b of index.bases) baseEl.add(new Option(b.nombre.replace(/^Base (Antártica )?/, ""), b.id, false, b.id === baseId));
  baseEl.addEventListener("change", () => {
    params.set("base", baseEl.value);
    location.search = params.toString();
  });

  const dir = `/terreno/${baseId}`;
  const metaRes = await fetch(`${dir}/terreno.json`);
  if (!metaRes.ok) return showStatus(`No hay terreno procesado para "${baseId}".`);
  const meta: TerrainMeta = await metaRes.json();
  document.title = `${meta.base.nombre} · Terreno nítido · Antaris Polar`;
  const plan = levelPlan(meta.levels, params.get("nivel"));

  // ─── Escena ───
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const L0 = plan[0];
  const size = Math.max((L0.width - 1) * L0.cellSizeM, (L0.height - 1) * L0.cellSizeM);
  const sky = new THREE.Color("#9fb6c6");
  const scene = new THREE.Scene();
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, size * 0.9, size * 2.6);
  scene.add(new THREE.HemisphereLight("#dfeaf2", "#3b4650", 1.1));
  const sun = new THREE.DirectionalLight("#fff3e2", 2.2); // sol bajo, típico de latitudes altas
  sun.position.set(-0.6, 0.35, -1).multiplyScalar(size);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 5, size * 6);
  const controls = new MapControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, minDistance: 60, maxDistance: size * 2.2, keyPanSpeed: 20 });
  controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
  controls.listenToKeyEvents(window);

  // ─── Render a demanda ───
  const metrics = new Metrics(renderer);
  const v = new THREE.Vector3();
  let pin: ReturnType<typeof buildPin> = null;
  let dirty = true;
  let running = false;
  let idleFrames = 0;
  const frame = () => {
    const moved = controls.update();
    if (!moved && !dirty) {
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
      pinEl.style.opacity = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 ? "1" : "0";
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

  // ─── Estado de la interfaz ───
  let after = params.get("modo") !== "antes";
  let exaggeration = 1;
  let terrain: Terrain | null = null;

  const setMode = (a: boolean) => {
    after = a;
    beforeBtn.setAttribute("aria-pressed", String(!a));
    afterBtn.setAttribute("aria-pressed", String(a));
    terrain?.setMode(a);
    updateNote();
    requestRender();
  };
  const updateNote = () => {
    if (!terrain) return;
    const L = terrain.level;
    noteEl.textContent = after
      ? `Después: luz y color por píxel con detalle de ${L.cellSizeM} m y sombreado de cavidades. Malla de ${L.cellSizeM * MESH_STRIDE} m.`
      : `Antes: luz y color calculados en los vértices de la malla (${L.cellSizeM * MESH_STRIDE} m), como en terreno-bases.`;
  };
  beforeBtn.addEventListener("click", () => setMode(false));
  afterBtn.addEventListener("click", () => setMode(true));
  addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "a" && !(e.target as HTMLElement).closest("select")) setMode(!after);
  });
  exaggerationEl.addEventListener("change", async () => {
    exaggeration = Number(exaggerationEl.value);
    const t = terrain;
    if (!t) return;
    await t.setExaggeration(exaggeration);
    if (terrain !== t) return;
    pin?.setExaggeration(exaggeration);
    requestRender();
  });
  $("copy-metrics").addEventListener("click", async () => {
    const json = JSON.stringify({ base: baseId, modo: after ? "despues" : "antes", ...metrics.snapshot() }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $("copy-metrics").textContent = "Copiado";
    } catch {
      console.log(json);
      $("copy-metrics").textContent = "Ver consola";
    }
    setTimeout(() => ($("copy-metrics").textContent = "Copiar métricas"), 1500);
  });
  setMode(after);

  // ─── Carga progresiva ───
  const loader = new TerrainLoader();
  const t0 = performance.now();
  const show = (t: Terrain) => {
    if (terrain) {
      scene.remove(terrain.mesh);
      terrain.dispose();
    }
    if (pin) scene.remove(pin.group);
    terrain = t;
    t.setMode(after);
    scene.add(t.mesh);
    pin = buildPin(meta, t, size);
    if (pin) {
      pin.setExaggeration(exaggeration);
      scene.add(pin.group);
      pinEl.textContent = meta.base.nombre.replace(/^Base (Antártica )?/, "Base ");
      pinEl.hidden = false;
    }
    sourceEl.textContent = describeSource(meta, t);
    updateNote();
    requestRender();
  };
  const info = (t: Terrain, firstViewMs: number, fullMs: number | null) => ({
    level: `alturas ${t.level.cellSizeM} m · malla ${t.meshSize.width}×${t.meshSize.height}`,
    bytes: t.level.transferBytes,
    transferBytes: null,
    fetchMs: t.ms.fetch,
    buildMs: t.ms.decode + t.ms.surface + t.ms.mesh,
    firstViewMs,
    fullMs,
  });

  const first = await loader.load(dir, meta, plan[0], exaggeration, after);
  show(first);
  const firstViewMs = performance.now() - t0;
  const p0 = pin as ReturnType<typeof buildPin>;
  controls.target.set(p0?.local.x ?? 0, 0, p0?.local.z ?? 0);
  camera.position.set(controls.target.x, size * 0.42, controls.target.z + size * 0.72);
  controls.update();
  statusEl.hidden = true;
  metrics.load = info(first, firstViewMs, null);
  requestRender();
  Object.assign(window, { __terreno: { scene, camera, controls, renderer, metrics, meta, requestRender, get terrain() { return terrain; } } });

  if (plan[1]) {
    const k = exaggeration;
    const detailed = await loader.load(dir, meta, plan[1], k, after);
    if (exaggeration !== k) await detailed.setExaggeration(exaggeration);
    show(detailed);
    metrics.load = info(detailed, firstViewMs, performance.now() - t0);
  }
}

/** 8 m primero; en pantallas grandes con mouse, después 4 m. ?nivel=4m|8m fuerza uno. */
function levelPlan(levels: Level[], forced: string | null): Level[] {
  const by = (n: string) => levels.find((l) => l.name === n)!;
  if (forced && levels.some((l) => l.name === forced)) return [by(forced)];
  const constrained = matchMedia("(pointer: coarse)").matches || innerWidth < 800;
  return constrained ? [by("8m")] : [by("8m"), by("4m")];
}

function buildPin(meta: TerrainMeta, t: Terrain, size: number) {
  const L = t.level;
  const [X, Y] = meta.base.projected;
  const [ox, oy] = meta.origin;
  const col = (X - ox) / L.cellSizeM - 0.5;
  const row = (oy - Y) / L.cellSizeM - 0.5;
  if (col < 0 || row < 0 || col > L.width - 1 || row > L.height - 1) return null;
  const local = new THREE.Vector3(col * L.cellSizeM - t.widthM / 2, 0, row * L.cellSizeM - t.depthM / 2);
  const g = t.heightsM[Math.round(row) * L.width + Math.round(col)];
  const ground = Number.isNaN(g) ? 0 : g;
  const stem = size * 0.03;
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: "#74acdf" });
  const line = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.0012, size * 0.0012, stem, 8), mat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(size * 0.005, 16, 12), mat);
  group.add(line, head);
  const top = new THREE.Vector3();
  const setExaggeration = (k: number) => {
    group.position.set(local.x, ground * k, local.z);
    line.position.y = stem / 2;
    head.position.y = stem;
    top.set(local.x, ground * k + stem, local.z);
  };
  setExaggeration(1);
  return { group, local, top, setExaggeration };
}

function describeSource(meta: TerrainMeta, t: Terrain) {
  const N = meta.geoid?.egm2008;
  const alt =
    N != null
      ? `≈ ${(meta.heights.minM - N).toFixed(0)}–${(meta.heights.maxM - N).toFixed(0)} m s. n. m.`
      : `${meta.heights.minM.toFixed(0)}–${meta.heights.maxM.toFixed(0)} m elipsoidales`;
  return [
    `Relieve: ${meta.fuentes.relieve}, ${meta.original.resolutionM} m → ${t.level.cellSizeM} m, alturas cada ${meta.heights.stepM} m`,
    `Alturas ${alt}`,
    meta.fuentes.costa ? `Mar: ${meta.fuentes.costa}` : "Sin costa",
    `Base: ${meta.fuentes.base}`,
    "Colores nieve/roca según pendiente: estético",
  ].join(" · ");
}
