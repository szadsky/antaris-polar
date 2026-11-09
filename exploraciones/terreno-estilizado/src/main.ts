import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { MESH_STRIDE, TerrainLoader, type GeoMode, type Level, type Style, type Terrain, type TerrainMeta } from "./terrain";
import { Metrics } from "./metrics";
import { applyPose, runBench, type BenchCtx } from "./bench";
import { AdaptiveQuality, TIERS, guessDevice, type Tier } from "./quality";
import type { Vec3 } from "./worker";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("scene");
const statusEl = $("status");
const pinEl = $("pin");
const baseEl = $<HTMLSelectElement>("base");
const exaggerationEl = $<HTMLSelectElement>("exaggeration");
const baseBtn = $<HTMLButtonElement>("style-base");
const styBtn = $<HTMLButtonElement>("style-sty");
const noteEl = $("style-note");
const sourceEl = $("source");
const metricsEl = $("metrics");
const qualityEl = $<HTMLSelectElement>("quality");
const qualityNoteEl = $("quality-note");

/** Sol de la interpretación: bajo (≈20°) y de costado respecto de la vista inicial. Fijo. */
const SUN: Vec3 = normalize([-0.8, 0.36, 0.5]);

const showStatus = (msg: string) => ((statusEl.hidden = false), (statusEl.textContent = msg));

main().catch((err) => {
  console.error(err);
  showStatus(`No se pudo cargar el terreno: ${err instanceof Error ? err.message : String(err)}`);
});

async function main() {
  if (!document.createElement("canvas").getContext("webgl2")) return showStatus("Este navegador no soporta WebGL 2.");
  if (typeof DecompressionStream === "undefined") return showStatus("Este navegador es demasiado antiguo para descomprimir el terreno.");

  const params = new URLSearchParams(location.search);
  if (params.get("ui") === "0") document.body.classList.add("no-ui");
  const index: { bases: { id: string; nombre: string }[] } = await (await fetch("/terreno/index.json")).json();
  const baseId = (params.get("base") ?? "brown").replace(/[^a-z0-9-]/g, "");
  for (const b of index.bases) baseEl.add(new Option(b.nombre.replace(/^Base (Antártica )?/, ""), b.id, false, b.id === baseId));
  baseEl.addEventListener("change", () => {
    params.set("base", baseEl.value);
    location.search = params.toString();
  });

  const dir = `/terreno/${baseId}`;
  const metaRes = await fetch(`${dir}/terreno.json`);
  if (!metaRes.ok) return showStatus(`No hay terreno procesado para "${baseId}".`);
  const meta: TerrainMeta = await metaRes.json();
  document.title = `${meta.base.nombre} · Terreno estilizado · Antaris Polar`;
  // ─── Calidad (fase 4): nivel inicial por dispositivo, o forzado con ?calidad= ───
  const device = guessDevice();
  const forcedTier = (["alta", "media", "baja"] as Tier[]).find((t) => t === params.get("calidad")) ?? null;
  const initialTier: Tier = forcedTier ?? device.tier;
  const plan = levelPlan(meta.levels, params.get("nivel"), initialTier === "baja" ? "8m" : device.level);

  // ─── Render ───
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TIERS[initialTier].dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const L0 = plan[0];
  const size = Math.max((L0.width - 1) * L0.cellSizeM, (L0.height - 1) * L0.cellSizeM);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 5, size * 8);
  const controls = new MapControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, minDistance: 60, maxDistance: size * 2.2, keyPanSpeed: 20 });
  controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
  controls.listenToKeyEvents(window);
  // Movimiento reducido (preferencia del sistema): sin inercia de cámara.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) controls.enableDamping = false;

  // Dos "looks": luces, tono, niebla y mar extendido.
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi, sun);
  const seaPlane = new THREE.Mesh<THREE.PlaneGeometry, THREE.Material>(
    new THREE.PlaneGeometry(size * 8, size * 8).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: "#14303f", roughness: 0.18, metalness: 0 })
  );
  const seaPlainMat = seaPlane.material;
  seaPlane.name = "mar-extendido";
  scene.add(seaPlane);
  const LOOKS: Record<Style, () => void> = {
    base: () => {
      // Idéntico a terreno-nitidez.
      scene.background = new THREE.Color("#9fb6c6");
      scene.fog = new THREE.Fog("#9fb6c6", size * 0.9, size * 2.6);
      hemi.color.set("#dfeaf2");
      hemi.groundColor.set("#3b4650");
      hemi.intensity = 1.1;
      sun.color.set("#fff3e2");
      sun.intensity = 2.2;
      sun.position.set(-0.6, 0.35, -1).multiplyScalar(size);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      seaPlane.visible = false;
    },
    estilizado: () => {
      // Cielo frío y luminoso; rebote de nieve como luz de suelo (evita roca negra).
      scene.background = new THREE.Color("#b9cddb");
      scene.fog = new THREE.Fog("#b9cddb", size * 0.55, size * 2.5);
      hemi.color.set("#cfe0ee");
      hemi.groundColor.set("#8796a0");
      hemi.intensity = 1.05;
      sun.color.set("#fff0d8");
      sun.intensity = 2.6;
      sun.position.set(SUN[0], SUN[1], SUN[2]).multiplyScalar(size);
      renderer.toneMapping = THREE.NeutralToneMapping; // no "quema" la nieve como ACES
      renderer.toneMappingExposure = 0.95;
      seaPlane.visible = true;
    },
  };

  // ─── Render a demanda ───
  const metrics = new Metrics(renderer);
  const v = new THREE.Vector3();
  let pin: ReturnType<typeof buildPin> = null;
  let dirty = true, running = false, idleFrames = 0;
  // Se asigna más abajo; el bucle puede correr antes (p. ej. por un resize temprano).
  let qualityRef: AdaptiveQuality | null = null;
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
    terrain?.beforeRender(camera, renderer.domElement.height);
    qualityRef?.begin();
    renderer.render(scene, camera);
    qualityRef?.end(moved);
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

  // ─── Estado ───
  let style: Style = params.get("estilo") === "base" ? "base" : "estilizado";
  const geo: GeoMode = params.get("geo") === "completa" ? "completa" : "lod";
  let exaggeration = 1;
  let terrain: Terrain | null = null;
  let benchResult: unknown = null;

  const setStyle = (s: Style) => {
    style = s;
    baseBtn.setAttribute("aria-pressed", String(s === "base"));
    styBtn.setAttribute("aria-pressed", String(s === "estilizado"));
    LOOKS[s]();
    terrain?.setStyle(s);
    noteEl.textContent =
      s === "base"
        ? "Base: sombreado de terreno-nitidez (luz y color por píxel, sin sombras, dos colores)."
        : "Interpretación artística basada en REMA: relieve real; sombras de un sol fijo, materiales, hielo costero y bordes son estilización, no reconstrucción exacta.";
    requestRender();
  };
  baseBtn.addEventListener("click", () => setStyle("base"));
  styBtn.addEventListener("click", () => setStyle("estilizado"));
  let detail = params.get("detalle") !== "0";
  const setDetail = (on: boolean) => {
    detail = on;
    terrain?.setDetail(on && TIERS[quality.tier].detail);
    requestRender();
  };
  // Aplica un nivel de calidad: DPR, densidad del LOD y detalle de cerca.
  const applyTier = (t: Tier, why: string) => {
    renderer.setPixelRatio(Math.min(devicePixelRatio, TIERS[t].dpr));
    renderer.setSize(innerWidth, innerHeight, false);
    terrain?.setLodTarget(TIERS[t].lodPx);
    terrain?.setDetail(detail && TIERS[t].detail);
    qualityNoteEl.textContent = `Calidad ${t}${quality.auto ? " (automática)" : ""}: ${why}`;
    requestRender();
  };
  const quality = new AdaptiveQuality(renderer.getContext() as WebGL2RenderingContext, initialTier, device.budgetMs, applyTier);
  quality.auto = !forcedTier;
  qualityRef = quality;
  qualityEl.value = forcedTier ?? "auto";
  qualityEl.addEventListener("change", () => {
    const v = qualityEl.value;
    quality.auto = v === "auto";
    if (quality.auto) applyTier(quality.tier, "ajuste automático según el tiempo de GPU");
    else {
      quality.tier = v as Tier;
      applyTier(v as Tier, "elegida a mano");
    }
  });
  qualityNoteEl.textContent = `Calidad ${initialTier}${forcedTier ? "" : " (automática)"}: ${forcedTier ? "forzada por URL" : device.reason}. Mide con ${quality.source === "gpu" ? "temporizador de GPU" : "intervalo entre cuadros"}.`;
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("select")) return;
    if (e.key.toLowerCase() === "a") setStyle(style === "base" ? "estilizado" : "base");
    if (e.key.toLowerCase() === "d") setDetail(!detail);
  });
  exaggerationEl.addEventListener("change", async () => {
    exaggeration = Number(exaggerationEl.value);
    const t = terrain;
    if (!t) return;
    await t.update(exaggeration);
    if (terrain !== t) return;
    placeSea(t);
    pin?.setExaggeration(exaggeration);
    requestRender();
  });
  $("copy-metrics").addEventListener("click", async () => {
    const json = JSON.stringify({ base: baseId, estilo: style, ...metrics.snapshot(), banco: benchResult }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $("copy-metrics").textContent = "Copiado";
    } catch {
      console.log(json);
      $("copy-metrics").textContent = "Ver consola";
    }
    setTimeout(() => ($("copy-metrics").textContent = "Copiar métricas"), 1500);
  });
  setStyle(style);

  // ─── Carga progresiva ───
  const loader = new TerrainLoader(SUN);
  const t0 = performance.now();
  const placeSea = (t: Terrain) => (seaPlane.position.y = ((t.seaLevelM ?? 0) - 0.6) * exaggeration);
  const show = (t: Terrain) => {
    if (terrain) {
      scene.remove(terrain.object);
      terrain.dispose();
    }
    if (pin) scene.remove(pin.group);
    terrain = t;
    t.setStyle(style);
    t.setDetail(detail && TIERS[quality.tier].detail);
    t.setLodTarget(TIERS[quality.tier].lodPx);
    scene.add(t.object);
    seaPlane.material = t.seaMaterial ?? seaPlainMat;
    placeSea(t);
    pin = buildPin(meta, t, size);
    if (pin) {
      pin.setExaggeration(exaggeration);
      scene.add(pin.group);
      pinEl.textContent = meta.base.nombre.replace(/^Base (Antártica )?/, "Base ");
      pinEl.hidden = params.get("ui") === "0";
    }
    sourceEl.textContent = describeSource(meta, t);
    requestRender();
  };
  const info = (t: Terrain, firstViewMs: number, fullMs: number | null) => ({
    level: `alturas ${t.level.cellSizeM} m · ${t.geo === "lod" ? "LOD por bloques" : `malla ${t.meshSize.width}×${t.meshSize.height}`}`,
    bytes: t.level.transferBytes,
    transferBytes: null,
    fetchMs: t.ms.fetch,
    buildMs: t.ms.decode + t.ms.surface + t.ms.light + t.ms.mesh,
    firstViewMs,
    fullMs,
  });

  const first = await loader.load(dir, meta, plan[0], exaggeration, style, maxAniso, geo);
  show(first);
  const firstViewMs = performance.now() - t0;
  const p0 = pin as ReturnType<typeof buildPin>;
  const origin = new THREE.Vector3(p0?.local.x ?? 0, 0, p0?.local.z ?? 0);
  const ctx: BenchCtx = { renderer, scene, camera, controls, origin, size, beforeRender: () => terrain?.beforeRender(camera, renderer.domElement.height), lodStats: () => terrain?.lodStats() ?? undefined };
  applyPose(ctx, Number(params.get("pose") ?? 0));
  statusEl.hidden = true;
  metrics.load = info(first, firstViewMs, null);
  requestRender();

  if (plan[1]) {
    const k = exaggeration;
    const detailed = await loader.load(dir, meta, plan[1], k, style, maxAniso, geo);
    if (exaggeration !== k) await detailed.update(exaggeration);
    show(detailed);
    metrics.load = info(detailed, firstViewMs, performance.now() - t0);
  }

  // ─── Banco de medición ───
  const bench = async (s?: Style) => {
    if (s) setStyle(s);
    const t = terrain!;
    const r = await runBench(ctx);
    benchResult = {
      estilo: style,
      geometria: geo,
      detalle: detail && TIERS[quality.tier].detail,
      calidad: { nivel: quality.tier, automatica: quality.auto, ultimaMedianaMs: quality.lastMedianMs, fuente: quality.source, dispositivo: device },
      base: baseId,
      nivel: metrics.load?.level,
      ...r,
      memoriaGpuMB: {
        geometria: +(t.gpuBytes().geometry / 1048576).toFixed(2),
        texturas: +(t.gpuBytes().textures / 1048576).toFixed(1),
      },
      descargaKB: Math.round(t.level.transferBytes / 1024),
      cargaMs: { primeraVista: Math.round(firstViewMs), worker: Math.round(t.ms.decode + t.ms.surface + t.ms.light + t.ms.mesh), sombras: Math.round(t.ms.light) },
      pantalla: `${renderer.domElement.width}×${renderer.domElement.height} (dpr ${renderer.getPixelRatio()})`,
      gpu: metrics.snapshot().gpu,
    };
    metricsEl.textContent = JSON.stringify(benchResult, null, 1);
    requestRender();
    return benchResult;
  };
  $("bench").addEventListener("click", () => void bench());
  Object.assign(window, {
    __terreno: { scene, camera, controls, renderer, metrics, meta, requestRender, setStyle, setDetail, quality, applyTier, get terrain() { return terrain; } },
    __bench: bench,
    __pose: (i: number) => {
      applyPose(ctx, i);
      requestRender();
    },
  });
}

/** 8 m primero; si el dispositivo da para 4 m, después 4 m. ?nivel=4m|8m fuerza uno. */
function levelPlan(levels: Level[], forced: string | null, max: "4m" | "8m"): Level[] {
  const by = (n: string) => levels.find((l) => l.name === n)!;
  if (forced && levels.some((l) => l.name === forced)) return [by(forced)];
  return max === "8m" ? [by("8m")] : [by("8m"), by("4m")];
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
  group.visible = !document.body.classList.contains("no-ui");
  return { group, local, top, setExaggeration };
}

function describeSource(meta: TerrainMeta, t: Terrain) {
  const N = meta.geoid?.egm2008;
  const alt = N != null ? `≈ ${(meta.heights.minM - N).toFixed(0)}–${(meta.heights.maxM - N).toFixed(0)} m s. n. m.` : `${meta.heights.minM.toFixed(0)}–${meta.heights.maxM.toFixed(0)} m elipsoidales`;
  return [
    `Relieve: ${meta.fuentes.relieve} (dato), ${t.level.cellSizeM} m, malla ${t.level.cellSizeM * MESH_STRIDE} m`,
    `Alturas ${alt}`,
    meta.fuentes.costa ? `Costa: ${meta.fuentes.costa}` : "Sin costa",
    `Base: ${meta.fuentes.base}`,
  ].join(" · ");
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
