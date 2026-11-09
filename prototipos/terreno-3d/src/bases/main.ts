/**
 * Mapa de bases antárticas argentinas.
 * SVG plano en EPSG:3031 (km), sin librerías de mapas: ~31 KB de datos con brotli.
 */
import "./bases.css";

interface Base {
  id: string;
  nombre: string;
  anio: number | null;
  permanente: boolean;
  estado: string;
  lat: number;
  lon: number;
  latDDM: string;
  lonDDM: string;
  elevacionM: number | null;
  elevacionDatum: string | null;
  poblacionPico: number | null;
  xKm: number;
  yKm: number;
}

interface MapData {
  bases: Base[];
  costa: { tierra: string; hielo?: string };
  fuentes: {
    bases: { dataset: string; url: string; uso: string; cita: string };
    costa: { dataset: string; licencia: string; cita: string };
  };
}

/** Bases con terreno 3D procesado: se completa con public/terrain/index.json. */
const TERRAIN = new Map<string, { nodataPercent: number; seaPercent: number | null }>();

const SVG_NS = "http://www.w3.org/2000/svg";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mapEl = document.querySelector<HTMLElement>(".map")!;
const svg = document.getElementById("map") as unknown as SVGSVGElement;
const markersEl = $("markers");
const detailEl = $("detail");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Vista: centro (cx, cy) y ancho w, en km del sistema SVG (y invertida).
const view = { cx: 0, cy: 0, w: 6000 };
const MIN_W = 25;
const MAX_W = 9000;
const markerById = new Map<string, HTMLButtonElement>();
const listById = new Map<string, HTMLButtonElement>();

main().catch((err) => {
  console.error(err);
  $("summary").textContent = "No se pudo cargar el mapa.";
});

async function main() {
  const res = await fetch("/map/antartida.json");
  if (!res.ok) throw new Error("Falta public/map/antartida.json: corré npm run build:map");
  const data: MapData = await res.json();
  const idx = await fetch("/terrain/index.json").then((r) => (r.ok ? r.json() : { terrains: [] }));
  for (const t of idx.terrains as { id: string; nodataPercent: number; seaPercent: number | null }[]) TERRAIN.set(t.id, t);

  drawGraticule();
  drawCoast(data);
  buildMarkers(data.bases);
  buildList(data.bases);
  buildSources(data);

  const perm = data.bases.filter((b) => b.permanente).length;
  $("summary").textContent = `Argentina opera ${data.bases.length} bases en la Antártida: ${perm} permanentes y ${
    data.bases.length - perm
  } temporarias. Elegí una para ubicarla.`;

  const all = fitBounds(svgBounds(), 0.08);
  const peninsula = fitBounds(
    pointsBounds(data.bases.filter((b) => b.id !== "belgrano-ii" && b.id !== "orcadas")),
    0.35
  );
  setView(all, false);

  // ─── Controles ───
  $("zoom-in").addEventListener("click", () => zoomBy(0.5));
  $("zoom-out").addEventListener("click", () => zoomBy(2));
  $("view-all").addEventListener("click", () => setView(all));
  $("view-peninsula").addEventListener("click", () => setView(peninsula));
  addEventListener("resize", () => render());
  attachPanZoom();

  // Enlace directo: bases.html#carlini
  const fromHash = location.hash.slice(1);
  if (fromHash && markerById.has(fromHash)) select(data.bases.find((b) => b.id === fromHash)!, false);
}

// ─── Dibujo ─────────────────────────────────────────────
function drawCoast(data: MapData) {
  const g = document.createElementNS(SVG_NS, "g");
  g.id = "coast-general";
  if (data.costa.hielo) g.appendChild(path(data.costa.hielo, "shelf"));
  g.appendChild(path(data.costa.tierra, "land"));
  svg.appendChild(g);
}

// ─── Detalle de la Península: se descarga solo al acercarse (~52 KB) ───
const DETAIL_BELOW_KM = 1500;
let detail: { group: SVGGElement; mask: string } | null = null;
let detailLoading = false;

async function loadPeninsulaDetail() {
  detailLoading = true;
  try {
    const res = await fetch("/map/peninsula.json");
    if (!res.ok) return;
    const p: {
      unidadM: number;
      recuadroKm: { x: number; y: number; w: number; h: number };
      costa: { tierra: string; hielo?: string };
    } = await res.json();
    // Máscara: la costa general se oculta dentro del recuadro del detalle.
    const defs = document.createElementNS(SVG_NS, "defs");
    const r = p.recuadroKm;
    defs.innerHTML = `<mask id="pen-hole" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="20000" height="20000">
      <rect x="-10000" y="-10000" width="20000" height="20000" fill="white"/>
      <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="black"/></mask>`;
    svg.prepend(defs);
    const group = document.createElementNS(SVG_NS, "g");
    group.id = "coast-peninsula";
    group.setAttribute("transform", `scale(${p.unidadM / 1000})`);
    if (p.costa.hielo) group.appendChild(path(p.costa.hielo, "shelf"));
    group.appendChild(path(p.costa.tierra, "land"));
    svg.querySelector("#coast-general")!.after(group);
    detail = { group, mask: "url(#pen-hole)" };
    render();
  } finally {
    detailLoading = false;
  }
}

function updateDetail() {
  const want = view.w < DETAIL_BELOW_KM;
  if (want && !detail && !detailLoading) void loadPeninsulaDetail();
  if (!detail) return;
  detail.group.style.display = want ? "" : "none";
  const general = svg.querySelector("#coast-general")!;
  if (want) general.setAttribute("mask", detail.mask);
  else general.removeAttribute("mask");
}

function path(d: string, cls: string) {
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("class", cls);
  return p;
}

/** Paralelos 60°, 70°, 80° S y meridianos cada 30°, con la misma proyección. */
function drawGraticule() {
  const g = document.createElementNS(SVG_NS, "g");
  for (const lat of [-60, -70, -80]) {
    const r = rhoKm(lat);
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("r", String(r));
    c.setAttribute("class", "grid");
    g.appendChild(c);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("class", "grid-label");
    t.dataset.lat = String(lat);
    t.textContent = `${-lat}° S`;
    g.appendChild(t);
  }
  for (let lon = -180; lon < 180; lon += 30) {
    const r = rhoKm(-60);
    const l = document.createElementNS(SVG_NS, "line");
    const lam = (lon * Math.PI) / 180;
    l.setAttribute("x1", "0");
    l.setAttribute("y1", "0");
    l.setAttribute("x2", String(r * Math.sin(lam)));
    l.setAttribute("y2", String(-r * Math.cos(lam)));
    l.setAttribute("class", "grid");
    g.appendChild(l);
  }
  svg.appendChild(g);
}

function buildMarkers(bases: Base[]) {
  for (const b of bases) {
    basePos.set(b.id, { x: b.xKm, y: -b.yKm });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `marker ${b.permanente ? "marker--perm" : "marker--temp"} ${
      b.estado !== "Open" ? "marker--closed" : ""
    }`;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", `${b.nombre}, ${b.permanente ? "permanente" : "temporaria"}`);
    btn.innerHTML = `<span class="marker__dot" aria-hidden="true"></span><span class="marker__label" aria-hidden="true">${shortName(
      b
    )}</span>`;
    btn.addEventListener("click", () => select(b));
    markersEl.appendChild(btn);
    markerById.set(b.id, btn);
  }
}

function buildList(bases: Base[]) {
  const groups: [boolean, string, string][] = [
    [true, "list-perm", "perm-title"],
    [false, "list-temp", "temp-title"],
  ];
  for (const [perm, listId, titleId] of groups) {
    const items = bases.filter((b) => b.permanente === perm);
    $(titleId).textContent = `${perm ? "Permanentes" : "Temporarias"} (${items.length})`;
    for (const b of items) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = `<span>${shortName(b)}</span><small>${
        b.estado !== "Open" ? "Temp. cerrada" : b.anio ? `desde ${b.anio}` : ""
      }</small>`;
      btn.addEventListener("click", () => select(b));
      li.appendChild(btn);
      $(listId).appendChild(li);
      listById.set(b.id, btn);
    }
  }
}

function buildSources(data: MapData) {
  const { bases, costa } = data.fuentes;
  $("sources").innerHTML = `
    <p><strong>Bases:</strong> <a href="${bases.url}" target="_blank" rel="noopener noreferrer">${bases.dataset}</a>. ${bases.uso}</p>
    <p><strong>Costa:</strong> ${costa.dataset}. ${costa.cita}. Licencia ${costa.licencia}.</p>
    <p>Proyección estereográfica polar sur (EPSG:3031). La escala es exacta a 71° S y varía con la latitud; el "arriba" del mapa no es el norte.</p>`;
}

// ─── Selección ──────────────────────────────────────────
function select(b: Base, animate = true) {
  for (const [id, el] of markerById) el.setAttribute("aria-pressed", String(id === b.id));
  for (const [id, el] of listById) el.setAttribute("aria-pressed", String(id === b.id));
  history.replaceState(null, "", `#${b.id}`);

  const terrain = TERRAIN.get(b.id);
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <h3>${b.nombre}</h3>
    <p>
      <span class="tag">${b.permanente ? "Permanente" : "Temporaria (de verano)"}</span>
      ${b.estado !== "Open" ? '<span class="tag tag--warn">Temporalmente cerrada</span>' : ""}
    </p>
    <dl>
      ${b.anio ? `<dt>Fundada</dt><dd>${b.anio}</dd>` : ""}
      <dt>Ubicación</dt><dd>${b.latDDM} · ${b.lonDDM}</dd>
      ${b.elevacionM != null ? `<dt>Altura</dt><dd>${fmt(b.elevacionM)} m ${b.elevacionDatum === "MSL" ? "s. n. m." : b.elevacionDatum ?? ""}</dd>` : ""}
      ${b.poblacionPico ? `<dt>Dotación máx.</dt><dd>${b.poblacionPico} personas</dd>` : ""}
    </dl>
    ${
      terrain
        ? `<a class="cta" href="./?base=${b.id}">Explorar el terreno 3D</a>
           <p class="note">Relieve real REMA 2 m, 8×8 km${b.id === "carlini" ? " (caleta Potter)" : " alrededor de la base"}${
             terrain.nodataPercent > 0 ? ` · ${terrain.nodataPercent.toFixed(1)} % sin dato` : ""
           }.</p>`
        : `<p class="note">Terreno 3D todavía no procesado para esta base.</p>`
    }`;

  // Acercar a ~300 km alrededor de la base.
  setView({ cx: b.xKm, cy: -b.yKm, w: Math.min(view.w, 300) }, animate);
}

// ─── Vista, pan y zoom ──────────────────────────────────
function size() {
  const r = mapEl.getBoundingClientRect();
  return { W: r.width, H: r.height };
}

function render() {
  const { W, H } = size();
  const h = (view.w * H) / W;
  svg.setAttribute("viewBox", `${view.cx - view.w / 2} ${view.cy - h / 2} ${view.w} ${h}`);
  const k = W / view.w; // px por km
  for (const [id, el] of markerById) {
    const b = baseOf(id);
    el.style.setProperty("--x", `${(b.x - (view.cx - view.w / 2)) * k}px`);
    el.style.setProperty("--y", `${(b.y - (view.cy - h / 2)) * k}px`);
  }
  // Con zoom regional hay lugar para las etiquetas.
  mapEl.classList.toggle("show-labels", view.w < 1800);
  // Etiquetas de los paralelos sobre el meridiano que mira a la cámara.
  for (const t of svg.querySelectorAll<SVGTextElement>(".grid-label")) {
    const r = rhoKm(Number(t.dataset.lat));
    t.setAttribute("x", String(r * Math.sin(-Math.PI * 0.75) + 6 / k));
    t.setAttribute("y", String(-r * Math.cos(-Math.PI * 0.75)));
    t.setAttribute("font-size", String(11 / k));
  }
  updateScale(k);
  updateDetail();
}

const basePos = new Map<string, { x: number; y: number }>();
function baseOf(id: string) {
  return basePos.get(id)!;
}

function setView(target: { cx: number; cy: number; w: number }, animate = true) {
  target.w = clamp(target.w, MIN_W, MAX_W);
  if (!animate || reduceMotion) {
    Object.assign(view, target);
    render();
    return;
  }
  const from = { ...view };
  const t0 = performance.now();
  const dur = 650;
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3); // ease-out
    // Zoom interpolado en escala logarítmica: se siente uniforme.
    view.w = Math.exp(lerp(Math.log(from.w), Math.log(target.w), e));
    view.cx = lerp(from.cx, target.cx, e);
    view.cy = lerp(from.cy, target.cy, e);
    render();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function zoomBy(factor: number, sx?: number, sy?: number) {
  const { W, H } = size();
  const px = sx ?? W / 2;
  const py = sy ?? H / 2;
  const k = W / view.w;
  const h = (view.w * H) / W;
  // Punto del mundo bajo el cursor: se mantiene fijo.
  const wx = view.cx - view.w / 2 + px / k;
  const wy = view.cy - h / 2 + py / k;
  const nw = clamp(view.w * factor, MIN_W, MAX_W);
  const nk = W / nw;
  const nh = (nw * H) / W;
  setView({ cx: wx - px / nk + nw / 2, cy: wy - py / nk + nh / 2, w: nw }, sx === undefined);
}

function attachPanZoom() {
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;

  mapEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = mapEl.getBoundingClientRect();
      zoomBy(Math.exp(e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false }
  );

  mapEl.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    mapEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mapEl.classList.add("is-dragging");
    if (pointers.size === 2) pinchDist = dist([...pointers.values()]);
  });

  mapEl.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const { W } = size();
    const k = W / view.w;
    if (pointers.size === 1) {
      view.cx -= (e.clientX - prev.x) / k;
      view.cy -= (e.clientY - prev.y) / k;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      render();
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = [...pointers.values()];
      const d = dist(pts);
      const r = mapEl.getBoundingClientRect();
      if (pinchDist > 0) zoomBy(pinchDist / d, (pts[0].x + pts[1].x) / 2 - r.left, (pts[0].y + pts[1].y) / 2 - r.top);
      pinchDist = d;
    }
  });

  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) mapEl.classList.remove("is-dragging");
  };
  mapEl.addEventListener("pointerup", end);
  mapEl.addEventListener("pointercancel", end);

  // Teclado: flechas mueven, +/- acercan (cuando el foco no está en un control).
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("input, select, textarea")) return;
    const stepKm = view.w * 0.15;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-stepKm, 0],
      ArrowRight: [stepKm, 0],
      ArrowUp: [0, -stepKm],
      ArrowDown: [0, stepKm],
    };
    if (moves[e.key] && !(e.target as HTMLElement).closest(".panel")) {
      e.preventDefault();
      setView({ cx: view.cx + moves[e.key][0], cy: view.cy + moves[e.key][1], w: view.w });
    } else if (e.key === "+" || e.key === "=") zoomBy(0.5);
    else if (e.key === "-") zoomBy(2);
  });
}

function updateScale(k: number) {
  // Barra de ~100 px con un valor redondo (válida cerca de 71° S).
  const targetKm = 100 / k;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].find((n) => n >= targetKm) ?? 2000;
  $("scale-bar").style.width = `${nice * k}px`;
  $("scale-label").textContent = `${nice} km`;
}

// ─── Geometría ──────────────────────────────────────────
function svgBounds() {
  const land = svg.querySelector<SVGPathElement>("#coast-general path.land")!.getBBox();
  const shelf = svg.querySelector<SVGPathElement>("#coast-general path.shelf")?.getBBox() ?? land;
  const x0 = Math.min(land.x, shelf.x);
  const y0 = Math.min(land.y, shelf.y);
  return {
    x0,
    y0,
    x1: Math.max(land.x + land.width, shelf.x + shelf.width),
    y1: Math.max(land.y + land.height, shelf.y + shelf.height),
  };
}

function pointsBounds(bases: Base[]) {
  const xs = bases.map((b) => b.xKm);
  const ys = bases.map((b) => -b.yKm);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function fitBounds(b: { x0: number; y0: number; x1: number; y1: number }, pad: number) {
  const { W, H } = size();
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const w = Math.max(bw, (bh * W) / H) * (1 + pad * 2);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, w };
}

/** Radio en km de un paralelo en EPSG:3031 (WGS84, lat_ts = -71°). */
function rhoKm(latDeg: number) {
  const E = 0.0818191908426215;
  const t = (phi: number) =>
    Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2);
  const phiC = (71 * Math.PI) / 180;
  const mc = Math.cos(phiC) / Math.sqrt(1 - E * E * Math.sin(phiC) ** 2);
  return (6378.137 * mc * t((-latDeg * Math.PI) / 180)) / t(phiC);
}

// ─── Utilidades ─────────────────────────────────────────
function shortName(b: Base) {
  return b.nombre.replace(/^Base (Antártica )?/, "");
}
const fmt = (n: number) => n.toLocaleString("es-AR");
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const dist = (p: { x: number; y: number }[]) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
