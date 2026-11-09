import { createOcean } from "./ocean";
import { loadTerrainTextures } from "./terrain-textures";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { MESH_STRIDE, TerrainLoader, type GeoMode, type Level, type Style, type Terrain, type TerrainMeta } from "./terrain";
import { Metrics } from "./metrics";
import { applyPose, runBench, runFpsTest, type BenchCtx } from "./bench";
import type { MaterialVariant } from "./shaders";
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
const materialEl = $<HTMLSelectElement>("material");
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
  if (params.get("ui") === "0") document.body.classList.add("no-ui", "captura");
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
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
  const ocean=createOcean(size,new THREE.Vector3(...SUN),device.mobile,initialTier);
  const seaPlane=ocean.mesh;
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
      seaPlane.visible = true;
    },
    estilizado: () => {
      // Cielo frío y luminoso; rebote de nieve como luz de suelo (evita roca negra).
      // Día despejado: la luz del commit 005af20 se veía nublada (mucho relleno de cielo respecto del sol).
      // Cielo más azul y sol más fuerte con menos relleno: más contraste, sin cambiar el modelo de luz.
      scene.background = new THREE.Color("#a6c8e6"); // antes #b9cddb
      scene.fog = new THREE.Fog("#a6c8e6", size * 0.55, size * 2.5);
      hemi.color.set("#b3d3f0"); // antes #cfe0ee
      hemi.groundColor.set("#8796a0");
      hemi.intensity = 1.0;
      sun.color.set("#fff3e0"); // antes #fff0d8
      sun.intensity = 3.3; // antes 2,6
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
  // Agua en movimiento (estilo Interpretación): en reposo se redibuja solo a ~24 cuadros/s; nada con
  // prefers-reduced-motion, con la pestaña oculta ni en el estilo Base.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const WAVE_IDLE_MS = 1000 / 24;
  let lastWaveMs = 0;
  const wavesOn = () => style === "estilizado" && !reducedMotion && seaPlane.visible && document.visibilityState === "visible" && (terrain?.styleUniforms.uSeaLook.value.z ?? 0) > 0;
  // Se asigna más abajo; el bucle puede correr antes (p. ej. por un resize temprano).
  let qualityRef: AdaptiveQuality | null = null;
  const frame = () => {
    const moved = controls.update();
    const now = performance.now();
    const waves = wavesOn();
    if (waves && terrain) { terrain.styleUniforms.uTime.value = now / 1000; ocean.time(now / 1000); }
    if (!moved && !dirty && waves) {
      // en reposo: solo el agua se mueve, a cadencia reducida
      if (now - lastWaveMs < WAVE_IDLE_MS) return;
      lastWaveMs = now;
      terrain?.beforeRender(camera, renderer.domElement.height);
      renderer.render(scene, camera);
      return;
    }
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
  // al volver a la pestaña, retomar el movimiento del agua (el bucle se detiene cuando está oculta)
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && requestRender());
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
    ocean.refresh();
    terrain?.setStyle(s);
    noteEl.textContent =
      s === "base"
        ? "Base: sombreado de terreno-nitidez (luz y color por píxel, sin sombras, dos colores)."
        : "Interpretación artística basada en REMA: relieve real; sombras de un sol fijo, materiales, hielo costero y bordes son estilización, no reconstrucción exacta.";
    requestRender();
  };
  baseBtn.addEventListener("click", () => setStyle("base"));
  styBtn.addEventListener("click", () => setStyle("estilizado"));
  // Prueba de materiales A/B/C (?material=a|b|c, tecla M). A = actual (por defecto).
  let variant: MaterialVariant = (["a", "b", "c", "n"] as MaterialVariant[]).find((x) => x === params.get("material")) ?? "n"; // Corregido por defecto (mejora demostrada)
  materialEl.value = variant;
  const setVariant = (v: MaterialVariant) => {
    variant = v;
    materialEl.value = v;
    terrain?.setVariant(v);
    requestRender();
  };
  materialEl.addEventListener("change", () => setVariant(materialEl.value as MaterialVariant));
  let detail = params.get("detalle") !== "0";
  const setDetail = (on: boolean) => {
    detail = on;
    terrain?.setDetail(on && TIERS[quality.tier].detail);
    requestRender();
  };
  // Aplica un nivel de calidad: DPR, densidad del LOD y detalle de cerca.
  const applyTier = (t: Tier, why: string) => {
    ocean.quality(t);
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
  // Ocultar / mostrar la interfaz para ver mejor el terreno (botón o tecla H). El botón queda visible.
  const uiToggleEl = document.getElementById("ui-toggle") as HTMLButtonElement;
  const setUiHidden = (hidden: boolean) => {
    document.body.classList.toggle("no-ui", hidden);
    uiToggleEl.textContent = hidden ? "Mostrar interfaz" : "Ocultar interfaz";
    uiToggleEl.title = (hidden ? "Mostrar" : "Ocultar") + " la interfaz (tecla H)";
    uiToggleEl.setAttribute("aria-pressed", String(hidden));
    if (pin) { pin.group.visible = !hidden; pinEl.hidden = hidden; }
    requestRender();
  };
  if (device.mobile && !params.has("ui")) setUiHidden(true);
  uiToggleEl.addEventListener("click", () => setUiHidden(!document.body.classList.contains("no-ui")));
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("select")) return;
    if (e.key.toLowerCase() === "h" && !document.body.classList.contains("captura")) setUiHidden(!document.body.classList.contains("no-ui"));
    if (e.key.toLowerCase() === "a") setStyle(style === "base" ? "estilizado" : "base");
    if (e.key.toLowerCase() === "d") setDetail(!detail);
    if (e.key.toLowerCase() === "m") setVariant(variant === "a" ? "b" : variant === "b" ? "c" : variant === "c" ? "n" : "a");
  });
  exaggerationEl.addEventListener("change", async () => {
    exaggeration = Number(exaggerationEl.value);
    const t = terrain;
    if (!t) return;
    await t.update(exaggeration);
    if (terrain !== t) return;
    placeSea(t);
    ocean.refresh();
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

  // Texturas KTX2 de roca y nieve: en paralelo al terreno; no retrasan la primera vista.
  let texInfo: { ms: number; bytes: number } | null = null;
  void loadTerrainTextures(renderer, maxAniso).then((r) => ((texInfo = r), requestRender()));

  // ─── Carga progresiva ───
  const loader = new TerrainLoader(SUN);
  const t0 = performance.now();
  const placeSea = (t: Terrain) => (seaPlane.position.y = (t.seaLevelM ?? 0) * exaggeration - 0.03);
  const show = (t: Terrain) => {
    if (terrain) {
      scene.remove(terrain.object);
      terrain.dispose();
    }
    if (pin) scene.remove(pin.group);
    terrain = t;
    t.setVariant(variant);
    t.setStyle(style);
    t.setDetail(detail && TIERS[quality.tier].detail);
    t.setLodTarget(TIERS[quality.tier].lodPx);
    scene.add(t.object);
    ocean.bind(t);
    placeSea(t);
    ocean.refresh();
    pin = buildPin(meta, t, size);
    if (pin) {
      pin.setExaggeration(exaggeration);
      scene.add(pin.group);
      pinEl.textContent = meta.base.nombre.replace(/^Base (Antártica )?/, "Base ");
      pinEl.hidden = document.body.classList.contains("no-ui");
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
      material: variant,
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
      texturas: texInfo ? { descargaKB: +(texInfo.bytes / 1024).toFixed(1), cargaMs: Math.round(texInfo.ms) } : null,
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
    __terreno: { scene, camera, controls, renderer, metrics, meta, requestRender, setStyle, setDetail, setVariant, quality, applyTier, fpsTest: (sec?: number) => runFpsTest(ctx, sec), get terrain() { return terrain; } },
    __bench: bench,
    // Diagnóstico por capas sobre el material estilizado: a = colores base, b = + variación de color,
    // c = + detalle al 15 %, d = material completo.
    __capa: (c: "a" | "b" | "c" | "d") => {
      const u = (terrain as unknown as { styleUniforms?: { uColorVar: { value: number }; uDetailGain: { value: number } } })?.styleUniforms;
      if (!u) return;
      u.uColorVar.value = c === "a" ? 0 : 1;
      u.uDetailGain.value = c === "a" || c === "b" ? 0 : c === "c" ? 0.15 : 1;
      requestRender();
    },
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
