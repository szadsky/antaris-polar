import {projectedToTerrain} from "./terrain-coordinates";
import {createPixelLook,type PixelParams} from "./pixel-look";
import {createIcebergs} from './icebergs';
import { solarPosition } from "./solar";
import { outerTerrain } from "./outer-terrain";
import { createDiorama } from "./diorama";
import { mountViewControls, mountMarineControls, mountPixelControls } from "./view-controls";
import { createOcean } from "./ocean";
import { loadTerrainTextures } from "./terrain-textures";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import { MESH_STRIDE, TerrainLoader, type GeoMode, type Level, type Style, type Terrain, type TerrainMeta } from "./terrain";
import { Metrics } from "./metrics";
import { applyPose, runBench, runFpsTest, type BenchCtx } from "./bench";
import type { MaterialVariant } from "./shaders";
import { AdaptiveQuality, TIERS, guessDevice, renderPixelRatio, type Tier } from "./quality";
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
  // Preserve hardware multisample depth at water/terrain intersections.
  // Fragment-written logarithmic depth produced jagged overlap boundaries.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(renderPixelRatio(devicePixelRatio, initialTier, device.mobile));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Read actual default-framebuffer MSAA support, not only the requested flag.
  const glAA = renderer.getContext();
  const antialiasInfo = { enabled: glAA.getContextAttributes()?.antialias ?? false, samples: glAA.getParameter(glAA.SAMPLES) as number };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const dateInput=$<HTMLInputElement>("solar-date"), timeInput=$<HTMLInputElement>("solar-time");
  const noon=new Date();
  noon.setUTCHours(12,Math.round(-meta.base.lon*4),0,0);
  dateInput.value=noon.toISOString().slice(0,10);
  timeInput.value=noon.toISOString().slice(11,16);
  const readSun=()=>solarPosition(new Date(dateInput.value+"T"+timeInput.value+"Z"),meta.base.lat,meta.base.lon);
  let solar=readSun();
  const SUN:Vec3=solar.direction.toArray();
  const L0 = plan[0];
  const size = Math.max((L0.width - 1) * L0.cellSizeM, (L0.height - 1) * L0.cellSizeM);
  const scene = new THREE.Scene();
  // Vista por defecto: diorama (bloque con corte lateral, agua estilizada sin reflejo planar, fondo liso).
  // ?vista=paisaje vuelve al paisaje abierto con océano hasta el horizonte.
  const diorama=params.get("vista")!=="paisaje" ? createDiorama() : null;
  const expanded = !diorama && baseId==="brown" && params.get("area")==="12";
  // The preprocessed mesh closes the land perimeter.
  const outerData = expanded ? await fetch(dir+"/exterior-60m.bin").then(async r=>{if(!r.ok) throw Error("Falta el relieve exterior"); return new Int16Array(await r.arrayBuffer());}) : null;
  let outer: ReturnType<typeof outerTerrain> | undefined;
  if(diorama) scene.add(diorama.group);
  // Con la pestaña oculta o el panel sin tamaño al cargar, innerWidth/innerHeight da 0/0 = NaN: la distancia
  // inicial del diorama salía NaN y la cámara quedaba en NaN para siempre (pantalla vacía). El resize la corrige.
  const camera = new THREE.PerspectiveCamera(45, innerHeight > 0 ? innerWidth / innerHeight : 16 / 9, 5, size * 8);
  const controls = new MapControls(camera, canvas);
  // De cerca: hasta 8 m del pivote (antes 60), zoom hacia el cursor y casi horizontal (88°) para mirar el paisaje
  // desde el suelo. El pivote se ancla al terreno al empezar cada gesto (anchorTargetToGround).
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, screenSpacePanning: false, minDistance: 8, maxDistance: size * 2.2, keyPanSpeed: 20, zoomToCursor: true, zoomSpeed: 1.8 });
  controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
  controls.listenToKeyEvents(window);
  // Movimiento reducido (preferencia del sistema): sin inercia de cámara.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) controls.enableDamping = false;

  // Dos "looks": luces, tono, niebla y mar extendido.
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  scene.add(hemi, sun);
  const ocean=createOcean(size,new THREE.Vector3(...SUN),device.mobile,initialTier,expanded,maxAniso,!!diorama);
  // En el diorama también el agua del océano (oleaje, Fresnel, reflejo), recortada al bloque en placeSea.
  // Se probó el mar estilizado del terreno (más barato, sin reflejo): se veía como una superficie plana, sin agua.
  const seaPlane=ocean.mesh;
  scene.add(seaPlane);
  const disc=new THREE.Mesh(new THREE.SphereGeometry(1,24,12),new THREE.MeshBasicMaterial({color:0xfff3d7,fog:false,toneMapped:false}));
  disc.scale.setScalar(camera.far*.8*Math.tan(THREE.MathUtils.degToRad(.266)));
  scene.add(disc);
  function illuminate(){
    const elevation=THREE.MathUtils.radToDeg(solar.altitude);
    const daylight=THREE.MathUtils.smoothstep(elevation,-12,5);
    const direct=THREE.MathUtils.smoothstep(elevation,0,12);
    sun.position.copy(solar.direction).multiplyScalar(size);
    sun.intensity=(style==="base"?2.2:3.3)*direct;
    sun.color.set(0xffac72).lerp(new THREE.Color(0xfff3e0),direct);
    hemi.intensity=.08+daylight;
    const sky=scene.background as THREE.Color;
    sky.set(0x101c34).lerp(new THREE.Color(diorama?0xdbe5ea:style==="base"?0x9fb6c6:0xa6c8e6),daylight); // diorama: fondo claro neutro
    if(scene.fog) scene.fog.color.copy(sky);
    disc.visible=elevation>0;
    ocean.setSun(solar.direction,sun.color,direct,daylight);
    $("solar-reading").textContent="Altura "+elevation.toFixed(1)+"° · Azimut "+((THREE.MathUtils.radToDeg(solar.bearing)+360)%360).toFixed(1)+"° desde el norte real";
  }
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
  let motionEnabled=params.get("movimiento")==="1" || !reducedMotion;
  const WAVE_IDLE_MS = 1000 / 24;
  let lastWaveMs = 0;
  let icebergMotionEnabled=motionEnabled,icebergSeconds=0,waterSeconds=0,lastMotionMs=performance.now();
  const wavesOn = () => style === "estilizado" && motionEnabled && seaPlane.visible && document.visibilityState === "visible";
  // Se asigna más abajo; el bucle puede correr antes (p. ej. por un resize temprano).
  let qualityRef: AdaptiveQuality | null = null;
  /** Altura del suelo (m de mundo, con exageración; nunca bajo el agua) en x, z: los dos triángulos REMA de la
   *  celda de malla, así una cima vecina no empuja la cámara al cruzar el borde de una celda. */
  function groundY(x:number,z:number) {
    if (!terrain) return 0;
    const t=terrain, {cellSizeM,width}=t.level;
    const step=cellSizeM*MESH_STRIDE;
    let floor=t.seaLevelM ?? 0;
    const gx=(x+t.widthM/2)/step;
    const gz=(z+t.depthM/2)/step;
    if (gx>=0 && gz>=0 && gx<=t.meshSize.width-1 && gz<=t.meshSize.height-1) {
      const cx=Math.min(Math.floor(gx),t.meshSize.width-2);
      const cz=Math.min(Math.floor(gz),t.meshSize.height-2);
      const u=gx-cx, v=gz-cz;
      const sample=(dx:number,dz:number)=>t.heightsM[(cz+dz)*MESH_STRIDE*width+(cx+dx)*MESH_STRIDE];
      const h=u+v<=1
        ? sample(0,0)*(1-u-v)+sample(1,0)*u+sample(0,1)*v
        : sample(1,1)*(u+v-1)+sample(1,0)*(1-v)+sample(0,1)*(1-u);
      if(Number.isFinite(h)) floor=Math.max(floor,h);
    }
    return floor*exaggeration;
  }
  /** Punto del terreno (o del agua) bajo un punto de la pantalla (NDC); null si el rayo va al cielo. */
  const pickRay=new THREE.Raycaster();
  function pickGround(ndcX:number,ndcY:number) {
    if (!terrain) return null;
    pickRay.setFromCamera(new THREE.Vector2(ndcX,ndcY),camera);
    const {origin,direction}=pickRay.ray;
    const above=(d:number)=>origin.y+direction.y*d-groundY(origin.x+direction.x*d,origin.z+direction.z*d);
    const far=size*3;
    let prev=0,d=Math.max(1,camera.near);
    if(above(0)<=0)return null;
    // marcha con paso creciente (≈ 1 % de la distancia, al menos medio paso de malla) y bisección al cruzar
    while(d<far){
      if(above(d)<=0){
        let a=prev,b=d;
        for(let i=0;i<12;i++){const m=(a+b)/2;if(above(m)>0)a=m;else b=m;}
        return origin.clone().addScaledVector(direction,b);
      }
      prev=d;d+=Math.max(terrain.level.cellSizeM,d*.01);
    }
    return null;
  }
  // Pivote en el suelo: al empezar cada gesto (arrastre, rueda, táctil), el centro de órbita, zoom y paneo pasa
  // al punto del terreno que está en el centro de la pantalla (sobre el mismo rayo de la vista: la imagen no
  // salta). Antes el pivote quedaba flotando a ~200 m sobre el mar (centro del diorama): de cerca la cámara no
  // pasaba de 60 m de ese punto en el aire, no llegaba al suelo, y zoom y paneo (proporcionales a la distancia
  // al pivote) se volvían lentos.
  function anchorTargetToGround() {
    const hit=pickGround(0,0);
    if(!hit)return;
    const d=hit.distanceTo(camera.position);
    if(d<controls.minDistance*1.05)return;
    // Mirando al horizonte desde abajo, el suelo del centro puede estar a kilómetros: con el pivote tan lejos,
    // orbitar barre el paisaje y el paneo salta. Tope: 8 veces la altura sobre el suelo (al menos 400 m),
    // sobre el mismo rayo (pivote en el aire, sin salto de imagen).
    const clearance=camera.position.y-groundY(camera.position.x,camera.position.z);
    const maxD=Math.max(400,clearance*8);
    if(d>maxD)controls.target.copy(camera.position).addScaledVector(hit.sub(camera.position).normalize(),maxD);
    else controls.target.copy(hit);
  }
  // Protect the eye and near plane when orbiting or panning across a cliff.
  function keepCameraAboveSurface() {
    if (!terrain) return;
    // mínimo 2 m sobre el suelo (antes 1,5 × plano cercano: 7,5 m)
    const minY=groundY(camera.position.x,camera.position.z)+2;
    if(camera.position.y<minY-0.001){
      camera.position.y=minY;
      camera.lookAt(controls.target);
      camera.updateMatrixWorld();
      dirty=true;
    }
  }
  const pixelLook=createPixelLook(renderer);
  const pixelToggle=$<HTMLInputElement>("pixel-toggle");
  pixelToggle.checked=params.get("pixel")==="1";pixelLook.setEnabled(pixelToggle.checked);
  pixelToggle.addEventListener("change",()=>{pixelLook.setEnabled(pixelToggle.checked);ocean.refresh();requestRender();});
  const disposePixelControls=mountPixelControls({...pixelLook.params},(key,value)=>{
    pixelLook.set(key as keyof PixelParams,value as never);requestRender();
  });
  window.addEventListener("pagehide",()=>{disposePixelControls();pixelLook.dispose();},{once:true});
  let benchmarking = false;
  renderer.info.autoReset = false;
  const drawScene = () => {
    renderer.info.reset();
    pixelLook.render(scene,camera);
  };
  const frame = () => {
    if(benchmarking)return;
    const moved = controls.update();
    keepCameraAboveSurface();
    // Plano cercano según la altura sobre el suelo y la distancia al pivote: lejos (diorama) hasta 50 m, más
    // precisión de profundidad; a ras del suelo hasta 1 m, para que el terreno cercano no se recorte.
    const clearance=terrain?camera.position.y-groundY(camera.position.x,camera.position.z):Infinity;
    const nextNear=THREE.MathUtils.clamp(Math.min(clearance,camera.position.distanceTo(controls.target))*.2,1,50);
    if(Math.abs(nextNear-camera.near)>Math.max(.05,camera.near*.1)){camera.near=nextNear;camera.updateProjectionMatrix();dirty=true;}
    // Paneo: MapControls mueve el suelo a la par del cursor (proporcional a la distancia al pivote); de cerca eso
    // es muy lento (a 24 m, 200 px = 8 m). Por debajo de 150 m se acelera, hasta ×4.
    controls.panSpeed=THREE.MathUtils.clamp(150/Math.max(1,camera.position.distanceTo(controls.target)),1,4);
    const now = performance.now();
    disc.position.copy(camera.position).addScaledVector(solar.direction,camera.far*.8);
    const waves = wavesOn();
    const dt=Math.min(.1,Math.max(0,(now-lastMotionMs)/1000));lastMotionMs=now;
    const floating=(icebergMotionEnabled || icebergs.interacting) && document.visibilityState === "visible" && icebergs.group.visible && icebergs.group.children.some(m=>m.visible);
    if(floating){if(icebergMotionEnabled)icebergSeconds+=dt;icebergs.animate(icebergSeconds,dt);}
    if (waves && terrain) { waterSeconds+=dt;terrain.styleUniforms.uTime.value=waterSeconds; ocean.time(waterSeconds,floating); }
    ocean.motion(floating);
    const rippling=ocean.stepRipples(dt);
    if (!moved && !dirty && (waves || floating || rippling)) {
      // en reposo: solo el agua se mueve, a cadencia reducida
      if (now - lastWaveMs < WAVE_IDLE_MS) return;
      lastWaveMs = now;
      terrain?.beforeRender(camera, renderer.domElement.height);
      qualityRef?.begin();
      drawScene();
      qualityRef?.end(false);
      if(metrics.tick())metricsEl.textContent=metrics.format();
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
    drawScene();
    qualityRef?.end(moved);
    if (pin) {
      v.copy(pin.top).project(camera);
      pinEl.style.opacity = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 ? "1" : "0";
      pinEl.dataset.side=((v.x+1)/2)*innerWidth>innerWidth-190?'left':'right';
      pinEl.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(0, 0)`;
    }
    if (metrics.tick()) metricsEl.textContent = metrics.format();
  };
  const requestRender = () => {
    dirty = true;
    if(benchmarking)return;
    if (!running) {
      running = true;
      metrics.wake();
      renderer.setAnimationLoop(frame);
    }
  };
  controls.addEventListener("change", requestRender);
  // al volver a la pestaña, retomar el movimiento del agua (el bucle se detiene cuando está oculta)
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && requestRender());
  controls.addEventListener("start", () => { anchorTargetToGround(); requestRender(); });
  addEventListener("resize", () => {
    if (innerHeight > 0) camera.aspect = innerWidth / innerHeight; // panel oculto: 0/0
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(renderPixelRatio(devicePixelRatio, qualityRef?.tier ?? initialTier, device.mobile));
    renderer.setSize(innerWidth, innerHeight, false);
    requestRender();
  });

  // ─── Estado ───
  let style: Style = params.get("estilo") === "base" ? "base" : "estilizado";
  const geo: GeoMode = params.get("geo") === "completa" ? "completa" : "lod";
  let exaggeration = 1;
  let terrain: Terrain | null = null;
  // Los icebergs van antes del `await` de los edificios: `frame` los usa, y si un render se disparaba durante
  // esa espera (resize, controles) tiraba "Cannot access 'icebergs' before initialization" y moría el bucle.
  const icebergs=createIcebergs();scene.add(icebergs.group);let bergsOn=true;icebergs.group.visible=bergsOn;
  const buildings=(await import('./base-buildings')).createBaseBuildings(baseId,meta.base.nombre,scene,camera,controls,requestRender);
  window.addEventListener('pagehide',()=>buildings?.dispose(),{once:true});
  let bergViewIndex=0;
  const marineControls=mountMarineControls({visible:bergsOn,floating:icebergMotionEnabled,
    onVisible(v){bergsOn=v;icebergs.group.visible=v;canvas.style.cursor='';marineControls.sync(v,icebergMotionEnabled);ocean.refresh();requestRender();},
    onFloating(v){icebergMotionEnabled=v;marineControls.sync(bergsOn,v);ocean.refresh();requestRender();},
    onIntensity(v){icebergs.setIntensity(v);icebergMotionEnabled=true;marineControls.sync(bergsOn,true);requestRender();},
    onSpeed(v){ocean.setSpeed(v);requestRender();},onWaves(v){ocean.setWaves(v);requestRender();},
    onView(){const visible=icebergs.group.children.filter(m=>m.visible);if(!visible.length)return;const m=visible[bergViewIndex++%visible.length];const target=m.position.clone().add(icebergs.group.position);target.y+=16;controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(115,65,145));bergsOn=true;icebergs.group.visible=true;marineControls.sync(true,icebergMotionEnabled);controls.update();ocean.refresh();requestRender();}
  });
  const icebergRay=new THREE.Raycaster();let icebergTap:{x:number;y:number;id:number;time:number}|null=null;
  const beginIcebergTap=(e:PointerEvent)=>{if(e.button!==0){icebergTap=null;return;}if(icebergTap){icebergTap=null;return;}icebergTap={x:e.clientX,y:e.clientY,id:e.pointerId,time:performance.now()};};
  const moveIcebergTap=(e:PointerEvent)=>{if(icebergTap&&Math.hypot(e.clientX-icebergTap.x,e.clientY-icebergTap.y)>6)icebergTap=null;};
  const cancelIcebergTap=()=>{icebergTap=null;};
  const endIcebergTap=(e:PointerEvent)=>{const tap=icebergTap;icebergTap=null;if(!tap||tap.id!==e.pointerId||performance.now()-tap.time>700||Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>6||!icebergs.group.visible)return;
    const rect=canvas.getBoundingClientRect();camera.updateMatrixWorld();icebergs.group.updateMatrixWorld(true);
    icebergRay.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    const hit=icebergRay.intersectObjects(icebergs.group.children.filter(m=>m.visible),false).find(h=>h.point.y>=seaPlane.position.y);
    if(hit&&icebergs.push(hit.object,hit.point)){
      const center=hit.object.getWorldPosition(new THREE.Vector3());
      ocean.disturb(center,50*hit.object.scale.x);ocean.refresh();requestRender();
    }
  };
  let lastBergHover=0;
  const clearBergHover=()=>{canvas.style.cursor='';};
  const hoverIceberg=(e:PointerEvent)=>{
    if(e.pointerType==='touch'||e.buttons||!icebergs.group.visible){clearBergHover();return;}
    const now=performance.now();if(now-lastBergHover<50)return;lastBergHover=now;
    const rect=canvas.getBoundingClientRect();camera.updateMatrixWorld();icebergs.group.updateMatrixWorld(true);
    icebergRay.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),camera);
    const hit=icebergRay.intersectObjects(icebergs.group.children.filter(m=>m.visible),false).find(h=>h.point.y>=seaPlane.position.y);
    canvas.style.cursor=hit?'pointer':'';
  };
  canvas.addEventListener('pointermove',hoverIceberg);canvas.addEventListener('pointerleave',clearBergHover);controls.addEventListener('start',clearBergHover);
  canvas.addEventListener('pointerdown',beginIcebergTap,true);canvas.addEventListener('pointermove',moveIcebergTap,true);canvas.addEventListener('pointerup',endIcebergTap,true);canvas.addEventListener('pointercancel',cancelIcebergTap,true);
  window.addEventListener('pagehide',()=>{canvas.removeEventListener('pointermove',hoverIceberg);canvas.removeEventListener('pointerleave',clearBergHover);controls.removeEventListener('start',clearBergHover);clearBergHover();canvas.removeEventListener('pointerdown',beginIcebergTap,true);canvas.removeEventListener('pointermove',moveIcebergTap,true);canvas.removeEventListener('pointerup',endIcebergTap,true);canvas.removeEventListener('pointercancel',cancelIcebergTap,true);icebergs.dispose();},{once:true});
  let benchResult: unknown = null;

  let syncViewControls: (()=>void) | undefined;
  const setStyle = (s: Style) => {
    style = s;
    syncViewControls?.();
    baseBtn.setAttribute("aria-pressed", String(s === "base"));
    styBtn.setAttribute("aria-pressed", String(s === "estilizado"));
    LOOKS[s]();
    if(diorama){scene.background=new THREE.Color("#dbe5ea");scene.fog=null;}
    ocean.refresh();
    illuminate();
    terrain?.setStyle(s);
    noteEl.textContent =
      s === "base"
        ? "Relieve base: representación simplificada con dos colores y sombreado del terreno."
        : "Interpretación artística basada en REMA: relieve real; sombras según fecha y hora, materiales, hielo costero y bordes son estilización, no reconstrucción exacta.";
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
    syncViewControls?.();
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
    renderer.setPixelRatio(renderPixelRatio(devicePixelRatio, t, device.mobile));
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
  let updating=false, pending=false;
  async function updateLighting(){ 
    pending=true;
    if(updating) return;
    updating=true;
    try { while(pending){
    pending=false;
    exaggeration = Number(exaggerationEl.value);
    const t = terrain;
    if (!t) return;
    await t.update(exaggeration);
    if (terrain !== t) continue;
    placeSea(t);
    ocean.refresh();
    pin?.setExaggeration(exaggeration);
    buildings?.setExaggeration(exaggeration);
    requestRender();
    }} finally {updating=false;}
  }
  exaggerationEl.addEventListener("change",updateLighting);
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
  syncViewControls=mountViewControls(()=>style,setStyle);
  setStyle(style);

  // Texturas KTX2 de roca y nieve: en paralelo al terreno; no retrasan la primera vista.
  let texInfo: { ms: number; bytes: number } | null = null;
  void loadTerrainTextures(renderer, maxAniso).then((r) => ((texInfo = r), requestRender()));

  // ─── Carga progresiva ───
  const loader = new TerrainLoader(SUN);
  const t0 = performance.now();
  const placeSea = (t: Terrain) => {
    if(!expanded && !diorama) t.styleUniforms.uEdgeHaze.value=-1;
    if(outer) outer.scale.y=exaggeration;
    seaPlane.position.y=(t.seaLevelM??0)*exaggeration-.03;
    icebergs.setSea(seaPlane.position.y);
    if(diorama){
      seaPlane.scale.set(t.widthM/(size*8),t.depthM/(size*8),1);
      diorama.update(t,exaggeration);
    }
  };
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
    if(outerData){
      if(outer){scene.remove(outer); outer.geometry.dispose(); outer.material.dispose();}
      outer=outerTerrain(t,outerData,meta.heights.minM);
      scene.add(outer);
      t.styleUniforms.uEdgeHaze.value=-1;
    }
    scene.add(t.object);
    buildings?.setTerrain(t,meta,exaggeration);
    ocean.bind(t);
    placeSea(t);
    ocean.refresh();
    pin = buildPin(meta, t);
    if (pin) {
      pin.setExaggeration(exaggeration);
      scene.add(pin.group);
      const label=document.createElement("span");label.textContent=meta.base.nombre.replace(/^Base (Antártica )?/, "Base ");pinEl.replaceChildren(label);
      pinEl.hidden = document.body.classList.contains("no-ui");
    }
    const count=icebergs.bind(t,pin?.local??new THREE.Vector3());marineControls.setAvailable(count>0);    const sourceRows = [...describeSource(meta, t), ...(count ? [`Escena: ${count} icebergs decorativos`] : []), ...(outerData ? ["Extensión: 12 × 12 km · exterior REMA a 60 m"] : [])];
    sourceEl.replaceChildren(...sourceRows.map(text => {
      const row = document.createElement("p");
      const colon = text.indexOf(":");
      if (colon >= 0) {
        const label = document.createElement("strong"); label.textContent = text.slice(0, colon);
        const value = document.createElement("span"); value.textContent = text.slice(colon + 1).trim();
        row.append(label, value);
      } else row.textContent = text;
      return row;
    }));
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
  const ctx: BenchCtx = { renderer, scene, camera, controls, origin, size, beforeRender: () => terrain?.beforeRender(camera, renderer.domElement.height), lodStats: () => terrain?.lodStats() ?? undefined, render: () => {
    const now=performance.now(),dt=Math.min(.1,Math.max(0,(now-lastMotionMs)/1000));lastMotionMs=now;
    if(icebergMotionEnabled){icebergSeconds+=dt;icebergs.animate(icebergSeconds,dt);}
    waterSeconds+=dt;ocean.time(waterSeconds,icebergMotionEnabled);ocean.stepRipples(dt);
    disc.position.copy(camera.position).addScaledVector(solar.direction,camera.far*.8);
    drawScene();
  } };
  if(diorama && !params.has("pose")){
    const distance=size*1.75/Math.min(1,Number.isFinite(camera.aspect)&&camera.aspect>0?camera.aspect:16/9);
    controls.maxDistance=Math.max(controls.maxDistance,distance*1.3);
    controls.target.set(0,(first.seaLevelM??0)+size*.025,0);
    camera.position.copy(new THREE.Vector3(.85,.77,1).normalize().multiplyScalar(distance)).add(controls.target);
    controls.update();
  }else if(expanded && !params.has("pose")){
    controls.target.copy(origin);
    camera.position.copy(origin).add(new THREE.Vector3(0, 5200, 8400));
    controls.update();
  }else applyPose(ctx, Number(params.get("pose") ?? 0));
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

  function changeSun(){
    if(!dateInput.value || !timeInput.value) return;
    solar=readSun();
    solar.direction.toArray(SUN);
    illuminate();
    requestRender();
    void updateLighting();
  }
  dateInput.onchange=timeInput.onchange=changeSun;
  changeSunIfEdited();
  function changeSunIfEdited(){
    if(dateInput.value!==noon.toISOString().slice(0,10) || timeInput.value!==noon.toISOString().slice(11,16)) changeSun();
  }
  // ─── Banco de medición ───
  const bench = async (s?: Style) => {
    if(benchmarking)return benchResult;
    if (s) setStyle(s);
    const t = terrain!;
    const savedPosition=camera.position.clone(),savedTarget=controls.target.clone(),savedAuto=quality.auto,savedDamping=controls.enableDamping;
    benchmarking=true;quality.auto=false;controls.enableDamping=false;
    const button=$<HTMLButtonElement>("bench");button.disabled=true;
    const report=$("bench-report");report.hidden=false;report.textContent="Midiendo cinco vistas y una órbita de 6 segundos…";
    try {
    const r = await runBench(ctx);
    const orbit=await runFpsTest(ctx,6);
    benchResult = {
      estilo: style,
      material: variant,
      geometria: geo,
      detalle: detail && TIERS[quality.tier].detail,
      calidad: { nivel: quality.tier, automatica: quality.auto, ultimaMedianaMs: quality.lastMedianMs, fuente: quality.source, dispositivo: device },
      base: baseId,
      nivel: metrics.load?.level,
      ...r,
      orbita: orbit,
      contorno: false,
      pixelArt: pixelToggle.checked,
      memoriaGpuParcialTerrenoMB: {
        geometria: +(t.gpuBytes().geometry / 1048576).toFixed(2),
        texturas: +(t.gpuBytes().textures / 1048576).toFixed(1),
      },
      recursos: performance.getEntriesByType("resource").map(e=>{const r=e as PerformanceResourceTiming;return {archivo:new URL(r.name).pathname,bytes:r.encodedBodySize,transferidos:r.transferSize,ms:Math.round(r.duration)};}),
      descargaDEMyMascaraKB: Math.round(t.level.transferBytes / 1024),
      texturas: texInfo ? { descargaKB: +(texInfo.bytes / 1024).toFixed(1), cargaMs: Math.round(texInfo.ms) } : null,
      cargaMs: { primeraVista: Math.round(firstViewMs), worker: Math.round(t.ms.decode + t.ms.surface + t.ms.light + t.ms.mesh), sombras: Math.round(t.ms.light) },
      antialias: antialiasInfo,
      pantalla: `${renderer.domElement.width}×${renderer.domElement.height} (dpr ${renderer.getPixelRatio()})`,
      gpu: metrics.snapshot().gpu,
    };
    report.textContent = JSON.stringify(benchResult, null, 1);
    return benchResult;
    } finally {
      camera.position.copy(savedPosition);controls.target.copy(savedTarget);controls.update();controls.enableDamping=savedDamping;
      quality.auto=savedAuto;benchmarking=false;button.disabled=false;metrics.wake();requestRender();
    }
  };
  $("bench").addEventListener("click", () => void bench());
  if(params.get("medir")==="1"){
    document.body.classList.remove("no-ui");
    const panel=metricsEl.closest("details")!;panel.style.display="block";panel.open=true;
    await bench();
  }
  Object.assign(window, {
    __terreno: { scene, camera, controls, renderer, antialiasInfo, metrics, meta, pixelLook, icebergStats:()=>icebergs.stats(), requestRender, setStyle, setDetail, setVariant, quality, applyTier, fpsTest: (sec?: number) => runFpsTest(ctx, sec), get terrain() { return terrain; } },
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

function buildPin(meta: TerrainMeta, t: Terrain) {
  const L = t.level;
  const [X, Y] = meta.base.projected;
  const {col,row,x,z}=projectedToTerrain(X,Y,meta.origin,L.cellSizeM,t.widthM,t.depthM);
  if (col < 0 || row < 0 || col > L.width - 1 || row > L.height - 1) return null;
  const local = new THREE.Vector3(x,0,z);
  const g = t.heightsM[Math.round(row) * L.width + Math.round(col)];
  const ground = Number.isNaN(g) ? 0 : g;
  // Screen-space marker: never grows into a column when approaching the base.
  const group = new THREE.Group();
  const top = new THREE.Vector3();
  const setExaggeration = (k: number) => {
    group.position.set(local.x, ground * k, local.z);
    top.set(local.x, ground * k + .5, local.z);
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
    `Alturas: ${alt}`,
    meta.fuentes.costa ? `Costa: ${meta.fuentes.costa}` : "Sin costa",
    `Base: ${meta.fuentes.base}`,
  ];
}

