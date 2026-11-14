import {repairHeightfield,type HeightfieldRepair} from "./heightfield-repair";
import { coastalNormals } from "./coastal-normals";
import { TILE } from "./tile-size";
import { buildCoastLod, type CoastLod } from "./coast-lod-build";
/**
 * Web Worker del terreno estilizado. A partir de UNA grilla de alturas REMA arma:
 *   - malla submuestreada (cada `stride` muestras);
 *   - surface (resolución completa, RGBA8): R,G normal (x,z) Sobel · B cavidades · A clase
 *     (0 sin dato · 128 mar según costa ADD · 255 tierra/hielo);
 *   - light (resolución de malla, RGBA8): R sombra del sol (255 = al sol) · G cercanía a la
 *     costa (255 en la línea de costa → 0 a SHORE_M) · B curvatura con signo del REMA (128 plano,
 *     > 128 surco/hondonada, < 128 cresta; escalas de 8 y 24 m) · A sin uso.
 * Nada de esto se descarga. Las sombras corresponden a un sol fijo (interpretación).
 */

export type Vec3 = [number, number, number];

export interface BuildMsg {
  type: "build";
  seaDatum: number | null;
  vector?: ArrayBuffer;
  baked?: ArrayBuffer;
  /** Optional measured coverage on exactly the same grid and vertical datum. */
  coverage?: ArrayBuffer;
  key: string;
  requestId?:number;
  bin: ArrayBuffer;
  mask: ArrayBuffer | null;
  /**
   * Distancia con signo a la costa ADD (scripts/costa-sdf.mjs): uint8 delta por filas, 128 = costa,
   * 1 m por unidad, + tierra. Si viene, reemplaza a `mask`.
   */
  sdf?: ArrayBuffer | null;
  width: number;
  height: number;
  cellSizeM: number;
  stepM: number;
  stride: number;
  exaggeration: number;
  sun: Vec3;
  /** true: arma la malla única de la fase 1 (para medir el "antes"). false: solo alturas para LOD. */
  full: boolean;
  /** Niveles de detalle de la malla costera (solo el visor; el horneado guarda la malla original). */
  coastLod?: boolean;
  /** Mandar antes las alturas a resolución de malla (precarga "construcción" del visor). */
  preview?: boolean;
}
/** Alturas REMA a resolución de malla, enviadas apenas se decodifican (antes de "built"). NaN = sin dato. */
export interface PreviewMsg {
  type: "preview";
  key: string;
  requestId?: number;
  heights: Float32Array;
  width: number;
  height: number;
  /** Lado de una celda de malla (m). */
  cellM: number;
  seaLevelM: number | null;
}
export interface UpdateMsg {
  type: "update";
  key: string;
  requestId?:number;
  exaggeration: number;
  sun: Vec3;
}
export interface BuiltMsg {
  type: "built";
  key: string;
  requestId?:number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  index: Uint32Array;
  surface: Uint8Array;
  light: Uint8Array;
  heightsM: Float32Array;
  provenance: HeightfieldRepair;
  /** Alturas (m, sin exagerar) a resolución de malla; NaN → 0. Textura de alturas del LOD. */
  meshHeights: Float32Array;
  /** 1 = la celda de malla es tierra/hielo (costa ADD), 0 = mar. */
  meshLand: Uint8Array;
  tileKinds: Uint8Array;
  mesh: { width: number; height: number };
  /** Modo LOD: rangos del índice por nivel y grupo de bloques costeros (coast-lod-build.ts). */
  coastLod?: Omit<CoastLod, "index">;
  seaLevelM: number | null;
  ms: { decode: number; surface: number; light: number; mesh: number; coastLod?: number };
}
export interface UpdatedMsg {
  type: "updated";
  key: string;
  requestId?:number;
  positions: Float32Array;
  normals: Float32Array;
  surface: Uint8Array;
  light: Uint8Array;
  ms: { light: number };
}

interface Grid {
  w: number;
  h: number;
  cell: number;
  stride: number;
  full: boolean;
  heights: Float32Array;
  land: Uint8Array | null;
  /** Distancia con signo a la costa (m, + tierra), resolución completa; null sin ella. */
  sdf: Int8Array | null;
  cavity: Uint8Array;
  /** Curvatura con signo (128 = plano, + surco, − cresta), resolución completa. */
  curv: Uint8Array;
  /** Nivel del mar del recorte (m); 0 si no hay costa. */
  sea: number;
  shore: Uint8Array; // a resolución de malla
  /** Igual que `shore` con alcance de 1,5 km (color del agua por profundidad). */
  farShore: Uint8Array;
  /** Muestras emergidas (1): tierra ADD, o REMA emergido y conectado a tierra donde la costa ADD queda tierra
   *  adentro. Su borde con el relleno de mar de REMA es la línea de agua real de la malla. null sin costa. */
  ground: Uint8Array | null;
  /** Distancia con signo (m, + emergido) al borde de `ground`, suavizada cerca del borde (su curva de cero pasa
   *  por el medio de los escalones de la grilla). Reemplaza a la distancia ADD en la textura y en la malla. */
  coastDist: Float32Array | null;
  /** 1 = muestra fuera de la tierra ADD alcanzada desde tierra (relleno vecino o REMA emergido conectado). */
  emerged: Uint8Array | null;
  /** Techo del relleno de mar de REMA (m): por encima, una muestra fuera de ADD cuenta como emergida. */
  oceanCeiling: number;
}

const SHORE_M = 160;
/** Fondo bajo el agua cerca de la costa (reconstrucción artística, no batimetría medida). */
const SEABED = true;
const SEABED_APRON_M = 100; // franja de fondo dibujada (más allá, el piso plano del océano)
const SEABED_MAX_M = 30; // = profundidad del piso en ocean.ts
const SEABED_SLOPE = (SEABED_MAX_M - 1.5) / SEABED_APRON_M; // llega al piso justo al final de la franja
const grids = new Map<string, Grid>();
const post = (m: unknown, t: Transferable[]) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = async (e: MessageEvent<BuildMsg | UpdateMsg | {type:"release";key:string}>) => {
  try {
    const msg = e.data;
    if(msg.type === "release"){grids.delete(msg.key);return;}
    if (msg.type === "build") {
      const t0 = performance.now();
      const raw = await gunzipMaybe(msg.bin);
      // Costa: distancia con signo (sub-celda) o, si falta, la máscara binaria.
      const sdf = msg.sdf ? decodeSdf(await gunzipMaybe(msg.sdf), msg.width) : null;
      let land: Uint8Array | null = msg.mask && !sdf ? await gunzipMaybe(msg.mask) : null;
      if (sdf) {
        land = new Uint8Array(sdf.length);
        for (let i = 0; i < sdf.length; i++) land[i] = sdf[i] > 0 ? 1 : 0;
      }
      const q = decodeDeltaPlanar(raw, msg.width);
      const heights = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) heights[i] = q[i] === 0 ? NaN : (q[i] - 1) * msg.stepM;
      let coverage:Float32Array|undefined;
      if(msg.coverage){const cq=decodeDeltaPlanar(await gunzipMaybe(msg.coverage),msg.width);if(cq.length!==heights.length)throw Error('Coverage dimensions mismatch');coverage=Float32Array.from(cq,q=>q?(q-1)*msg.stepM:NaN);}
      const provenance=repairHeightfield(heights,msg.width,msg.height,land,coverage);
      // All geometry paths consume the same repaired heightfield and provenance.
      const seaM = msg.seaDatum ?? seaLevel(heights, land);
      const t1 = performance.now();
      // Vista previa (precarga "construcción"): alturas REMA a resolución de malla apenas decodificadas, antes de las
      // texturas y la malla (que tardan la mayor parte). Solo si el visor la pide.
      if (msg.preview) {
        const pw = Math.floor((msg.width - 1) / msg.stride) + 1, ph = Math.floor((msg.height - 1) / msg.stride) + 1;
        const pv = new Float32Array(pw * ph);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pv[y * pw + x] = heights[y * msg.stride * msg.width + x * msg.stride];
        const pre: PreviewMsg = { type: "preview", key: msg.key, requestId: msg.requestId, heights: pv, width: pw, height: ph, cellM: msg.cellSizeM * msg.stride, seaLevelM: seaM ?? null };
        post(pre, [pv.buffer]);
      }

      const { cavity, curv } = cavityShade(heights, msg.width, msg.height, msg.cellSizeM);
      const shore = shoreProximity(land, msg.width, msg.height, msg.stride, msg.cellSizeM);
      const farShore = shoreProximity(land, msg.width, msg.height, msg.stride, msg.cellSizeM, FAR_SHORE_M);
      const vector: VectorCoast | undefined = msg.vector ? JSON.parse(new TextDecoder().decode(await gunzipMaybe(msg.vector))) : undefined;
      const g: Grid = { w: msg.width, h: msg.height, cell: msg.cellSizeM, stride: msg.stride, full: msg.full, heights, land, sdf, cavity, curv, shore, farShore, sea: seaM ?? 0, ground: null, coastDist: null, emerged: null, oceanCeiling: seaM ?? 0 };
      Object.assign(g, groundField(g, !!vector));
      grids.set(msg.key, g);
      const surface = surfaceTexture(g, msg.exaggeration);
      const t2 = performance.now();
      const light = lightTexture(g, msg.exaggeration, msg.sun);
      const t3 = performance.now();
      const m = msg.baked && provenance.indices.length===0 ? readBaked(await gunzipMaybe(msg.baked),g) : meshFrom(g, vector);
      // Modo LOD: niveles de detalle de la malla costera (coast-lod-build.ts). El índice pasa a ser el de todos los
      // niveles; el visor elige por grupo de bloques según la distancia.
      let coastLod: BuiltMsg["coastLod"];
      if (!msg.full && msg.coastLod) {
        const c = await buildCoastLod(m.positions, m.index, m.normals, m.mesh.width, m.mesh.height, g.cell * g.stride);
        m.index = c.index;
        coastLod = { ranges: c.ranges, boxes: c.boxes, errors: c.errors, groups: c.groups, ms: c.ms };
      }
      const { meshHeights, meshLand } = meshResolution(g);
      const heightsCopy = heights.slice();
      const out: BuiltMsg = {
        type: "built",
        key: msg.key,requestId:msg.requestId,
        ...m,
        coastLod,
        surface,
        light,
        heightsM: heightsCopy,
        provenance,
        meshHeights,
        meshLand,
        seaLevelM: seaM,
        ms: { decode: t1 - t0, surface: t2 - t1, light: t3 - t2, mesh: performance.now() - t3, coastLod: coastLod?.ms ?? 0 },
      };
      post(out, [
        m.positions.buffer, m.normals.buffer, m.uvs.buffer, m.index.buffer,
        surface.buffer, light.buffer, heightsCopy.buffer, meshHeights.buffer, meshLand.buffer,provenance.indices.buffer,provenance.sources.buffer,
        ...(coastLod ? [coastLod.ranges.buffer, coastLod.boxes.buffer] : []),
      ]);
    } else {
      const g = grids.get(msg.key);
      if (!g) throw Error("Terrain has been released");
      const surface = surfaceTexture(g, msg.exaggeration);
      const t0 = performance.now();
      const light = lightTexture(g, msg.exaggeration, msg.sun);
      const ms = { light: performance.now() - t0 };
      // Con LOD la exageración es un uniform del shader: no hace falta rehacer vértices.
      const { positions, normals } = emptyMesh(g);
      const out: UpdatedMsg = { type: "updated", key: msg.key,requestId:msg.requestId, positions, normals, surface, light, ms };
      post(out, [positions.buffer, normals.buffer, surface.buffer, light.buffer]);
    }
  } catch (err) {
    if(e.data.type==="build")grids.delete(e.data.key);
    post({ type: "error", key:e.data.key, requestId:"requestId" in e.data?e.data.requestId:undefined, message: err instanceof Error ? err.message : String(err) }, []);
  }
};

// ─── Superficie (resolución completa) ──────────────────────
function surfaceTexture(g: Grid, k: number): Uint8Array {
  const { w, h, cell, heights, land, cavity, sdf, ground, coastDist } = g;
  const out = new Uint8Array(w * h * 4);
  const mask = ground ?? land;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Mar = relleno de REMA fuera de las muestras emergidas (no la tierra ADD): la textura sigue la misma
      // costa que la malla. El relleno no es una ladera medida: normal plana (antes, junto a la costa ADD se le
      // calculaba la normal con el salto al acantilado vecino, y el frente no se reconocía como pared).
      const isSea = mask ? mask[i] === 0 : false;
      let nx = 0;
      let nz = 0;
      if (!isSea || heights[i] > g.sea) { sobelNormalXZ(heights, w, h, x, y, cell, k, mask, g.sea); nx = sobelOut[0]; nz = sobelOut[1]; }
      out[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      out[i * 4 + 1] = Math.round((nz * 0.5 + 0.5) * 255);
      out[i * 4 + 2] = cavity[i];
      // A = distancia con signo a la costa: 128 + 8 × metros (±12 m), interpolable → la línea
      // tierra/agua cae entre texeles, sin escalones. Sin distancia: ±12 m fijos. 0 = sin dato.
      const sd = coastDist ? coastDist[i] : sdf ? sdf[i] : isSea ? -12 : 12;
      out[i * 4 + 3] = Number.isNaN(heights[i]) ? 0 : 128 + Math.max(-12, Math.min(12, sd)) * 8;
    }
  }
  return out;
}

/**
 * Normal por operador de Sobel (3×3): promedia el gradiente de tres filas/columnas.
 * Frente a las diferencias centrales simples, atenúa el ruido residual de la
 * cuantización, que la exageración vertical amplificaba en franjas.
 */
// Resultado de sobelNormalXZ ([nx, nz]): se reutiliza en vez de crear un array y una función por píxel
// (4 millones de llamadas en la grilla de 4 m). Mismas operaciones en el mismo orden: mismos bytes.
const sobelOut = new Float64Array(2);
function sobelAt(hs: Float32Array, w: number, h: number, x: number, y: number, c: number, land: Uint8Array | null, sea: number, xx: number, yy: number) {
  xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
  yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
  const idx=yy*w+xx;
  const v=hs[idx];
  // Marine fill is not a measured hillside. Use a one-sided derivative on land.
  if(land && Number.isFinite(c) && c>sea && !land[idx] && v<=sea){
    const ox=2*x-xx, oy=2*y-yy;
    if(ox>=0 && ox<w && oy>=0 && oy<h){
      const opposite=oy*w+ox;
      if(land[opposite] && Number.isFinite(hs[opposite]))return 2*c-hs[opposite];
    }
    return c;
  }
  return v === v ? v : c === c ? c : 0;
}
function sobelNormalXZ(hs: Float32Array, w: number, h: number, x: number, y: number, cell: number, k: number, land: Uint8Array | null, sea: number) {
  const c = hs[y * w + x];
  const a = sobelAt(hs, w, h, x, y, c, land, sea, x - 1, y - 1), b = sobelAt(hs, w, h, x, y, c, land, sea, x, y - 1), cc = sobelAt(hs, w, h, x, y, c, land, sea, x + 1, y - 1);
  const d = sobelAt(hs, w, h, x, y, c, land, sea, x - 1, y), f = sobelAt(hs, w, h, x, y, c, land, sea, x + 1, y);
  const g = sobelAt(hs, w, h, x, y, c, land, sea, x - 1, y + 1), hh = sobelAt(hs, w, h, x, y, c, land, sea, x, y + 1), i = sobelAt(hs, w, h, x, y, c, land, sea, x + 1, y + 1);
  const dx = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * cell);
  const dz = (g + 2 * hh + i - (a + 2 * b + cc)) / (8 * cell);
  const nx = -dx * k;
  const nz = -dz * k;
  const len = Math.hypot(nx, 1, nz);
  sobelOut[0] = nx / len;
  sobelOut[1] = nz / len;
}

// ─── Luz (resolución de malla) ─────────────────────────────
/**
 * Sombra del sol por marcha de rayos sobre el relieve: desde cada celda se avanza
 * hacia el sol con pasos crecientes (8 m → ~6 km) y se compara la altura del rayo con
 * la del terreno. Penumbra suave proporcional a la distancia. Sol fijo: se recalcula
 * solo si cambia la exageración vertical.
 */
function lightTexture(g: Grid, k: number, sun: Vec3): Uint8Array {
  const { w, h, cell, stride, heights, shore, curv } = g;
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const mc = cell * stride;
  // Alturas a resolución de malla (sin dato → nivel del mar)
  const H = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const v = heights[y * stride * w + x * stride];
    H[y * mw + x] = (v === v ? v : g.sea) * k;
  }
  const horiz = Math.hypot(sun[0], sun[2]);
  const dx = sun[0] / horiz; // dirección en la grilla: x → columnas, z → filas
  const dz = sun[2] / horiz;
  const tanE = sun[1] / horiz;
  const out = new Uint8Array(mw * mh * 4);
  const maxDist = 6000;
  // Los pasos del rayo (8 m → ~6 km, ×1,09) son los mismos para todas las celdas: sus desplazamientos, la
  // subida del rayo y el ancho de la penumbra se calculan una vez (mismas operaciones: mismos bytes).
  const steps: number[] = [];
  for (let d = mc; d < maxDist; d *= 1.09) steps.push(d);
  const n = steps.length, offX = new Float64Array(n), offZ = new Float64Array(n), rise = new Float64Array(n), penumbra = new Float64Array(n);
  for (let s = 0; s < n; s++) { const d = steps[s]; offX[s] = (dx * d) / mc; offZ[s] = (dz * d) / mc; rise[s] = d * tanE; penumbra[s] = d * 0.035; }
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x;
      const h0 = H[i] + 1.5; // sesgo: evita autosombra por ruido
      let lit = 1;
      for (let s = 0; s < n; s++) {
        // bilineal en coordenadas de celda; fuera de la grilla termina el rayo
        const fx = x + offX[s], fz = y + offZ[s];
        const x0 = Math.floor(fx), z0 = Math.floor(fz);
        if (x0 < 0 || z0 < 0 || x0 >= mw - 1 || z0 >= mh - 1) break;
        const tx = fx - x0, tz = fz - z0;
        const j = z0 * mw + x0;
        const ht = (H[j] * (1 - tx) + H[j + 1] * tx) * (1 - tz) + (H[j + mw] * (1 - tx) + H[j + mw + 1] * tx) * tz;
        const ray = h0 + rise[s];
        if (ht > ray) {
          lit = 0;
          break;
        }
        // penumbra: cuánto margen deja el terreno respecto del rayo, relativo a la distancia
        lit = Math.min(lit, ((ray - ht) / penumbra[s]));
      }
      out[i * 4] = Math.round(Math.max(0, Math.min(1, lit)) * 255);
      out[i * 4 + 1] = shore[i];
      out[i * 4 + 2] = curv[y * stride * w + x * stride];
      // A = cercanía a la costa de largo alcance (255 en la costa → 0 a 1,5 km): el agua la usa como profundidad
      // aproximada para su color (reconstrucción artística, no batimetría)
      out[i * 4 + 3] = g.farShore[i];
    }
  }
  return out;
}

/** Cercanía a la línea de costa (distancia de chaflán, dos pasadas, O(n)): 255 en la costa → 0 a `rangeM`. */
function shoreProximity(land: Uint8Array | null, w: number, h: number, stride: number, cell: number, rangeM = SHORE_M): Uint8Array {
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const out = new Uint8Array(mw * mh);
  if (!land) return out;
  const L = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) L[y * mw + x] = land[y * stride * w + x * stride];
  const INF = 1e9;
  const D = new Float32Array(mw * mh).fill(INF);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const i = y * mw + x;
    const v = L[i];
    if ((x > 0 && L[i - 1] !== v) || (x < mw - 1 && L[i + 1] !== v) || (y > 0 && L[i - mw] !== v) || (y < mh - 1 && L[i + mw] !== v)) D[i] = 0;
  }
  const s2 = Math.SQRT2;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const i = y * mw + x;
    if (x > 0) D[i] = Math.min(D[i], D[i - 1] + 1);
    if (y > 0) D[i] = Math.min(D[i], D[i - mw] + 1);
    if (x > 0 && y > 0) D[i] = Math.min(D[i], D[i - mw - 1] + s2);
    if (x < mw - 1 && y > 0) D[i] = Math.min(D[i], D[i - mw + 1] + s2);
  }
  for (let y = mh - 1; y >= 0; y--) for (let x = mw - 1; x >= 0; x--) {
    const i = y * mw + x;
    if (x < mw - 1) D[i] = Math.min(D[i], D[i + 1] + 1);
    if (y < mh - 1) D[i] = Math.min(D[i], D[i + mw] + 1);
    if (x < mw - 1 && y < mh - 1) D[i] = Math.min(D[i], D[i + mw + 1] + s2);
    if (x > 0 && y < mh - 1) D[i] = Math.min(D[i], D[i + mw - 1] + s2);
  }
  const mc = cell * stride;
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, 1 - (D[i] * mc) / rangeM) * 255);
  return out;
}
/** Alcance de la cercanía a la costa de largo alcance (canal A de la textura de luz): color del agua por profundidad. */
const FAR_SHORE_M = 1500;

/**
 * Muestras emergidas y distancia a su borde (ver Grid.ground / Grid.coastDist). Si la costa ADD corta una
 * ladera por encima del agua, se siguen las muestras REMA emergidas y conectadas a esa tierra (BFS) hasta el
 * borde real con el relleno de mar. La distancia es un chaflán a resolución nativa; cerca del borde (±1,4
 * celdas) se reemplaza por el borde suavizado con dos pasadas de caja 3×3, cuya curva de cero pasa por el medio
 * de los escalones de la grilla: sobre ella se corren los vértices de costa y cae la línea de agua pintada.
 */
function groundField(g: Grid, vector: boolean): Pick<Grid, "ground" | "coastDist" | "emerged" | "oceanCeiling"> {
  const { w, h, cell, heights, land } = g;
  if (!land) return { ground: null, coastDist: null, emerged: null, oceanCeiling: g.sea };
  // Techo del relleno de mar: el valor dominante de las muestras fuera de ADD (sin cambiar el DEM).
  const oceanCodes = new Map<number, number>(); let oceanSamples = 0, oceanMode = g.sea, modeCount = 0;
  for (let i = 0; i < heights.length; i += 17) if (!land[i] && Number.isFinite(heights[i])) {
    const v = heights[i], n = (oceanCodes.get(v) ?? 0) + 1; oceanCodes.set(v, n); oceanSamples++;
    if (n > modeCount) { modeCount = n; oceanMode = v; }
  }
  const oceanCeiling = Math.max(g.sea, modeCount > oceanSamples * .5 ? oceanMode + .5 : g.sea);
  const emerged = new Uint8Array(heights.length);
  if (!vector) {
    const queue = new Int32Array(heights.length);
    let head = 0, tail = 0;
    const visit = (i: number) => {
      if (emerged[i] || land[i] || !Number.isFinite(heights[i])) return;
      emerged[i] = 1;
      if (heights[i] > oceanCeiling) queue[tail++] = i;
    };
    const neighbors = (i: number) => {
      if (i % w) visit(i - 1);
      if (i % w < w - 1) visit(i + 1);
      if (i >= w && i % w < w - 1) visit(i - w + 1);
      if (i + w < heights.length && i % w) visit(i + w - 1);
      if (i >= w) visit(i - w);
      if (i + w < heights.length) visit(i + w);
    };
    for (let i = 0; i < heights.length; i++) if (land[i] && Number.isFinite(heights[i])) neighbors(i);
    while (head < tail) neighbors(queue[head++]);
  }
  const ground = new Uint8Array(w * h);
  for (let i = 0; i < ground.length; i++) ground[i] = land[i] === 1 || (emerged[i] !== 0 && heights[i] > oceanCeiling) ? 1 : 0;
  // chaflán (celdas) al borde de ground: 0,5 en las dos filas pegadas al borde
  const Dn = new Float32Array(w * h).fill(1e9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = ground[i];
    if ((x > 0 && ground[i - 1] !== v) || (x < w - 1 && ground[i + 1] !== v) || (y > 0 && ground[i - w] !== v) || (y < h - 1 && ground[i + w] !== v)) Dn[i] = 0.5;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) Dn[i] = Math.min(Dn[i], Dn[i - 1] + 1);
    if (y > 0) Dn[i] = Math.min(Dn[i], Dn[i - w] + 1, x > 0 ? Dn[i - w - 1] + Math.SQRT2 : 1e9, x < w - 1 ? Dn[i - w + 1] + Math.SQRT2 : 1e9);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) Dn[i] = Math.min(Dn[i], Dn[i + 1] + 1);
    if (y < h - 1) Dn[i] = Math.min(Dn[i], Dn[i + w] + 1, x < w - 1 ? Dn[i + w + 1] + Math.SQRT2 : 1e9, x > 0 ? Dn[i + w - 1] + Math.SQRT2 : 1e9);
  }
  // borde suavizado: dos pasadas de caja 3×3 sobre ground; (B − 0,5) × 3 celdas deja la primera fila a ±0,5
  const box3 = (src: Float32Array | Uint8Array) => {
    const tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; tmp[i] = (src[i - (x > 0 ? 1 : 0)] + src[i] + src[i + (x < w - 1 ? 1 : 0)]) / 3; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; dst[i] = (tmp[i - (y > 0 ? w : 0)] + tmp[i] + tmp[i + (y < h - 1 ? w : 0)]) / 3; }
    return dst;
  };
  const coastDist = box3(box3(ground));
  for (let i = 0; i < coastDist.length; i++) {
    const p = (coastDist[i] - 0.5) * 3;
    coastDist[i] = (Math.abs(p) < 1.4 ? p : (ground[i] ? 1 : -1) * Math.max(Dn[i], 1.4)) * cell;
  }
  return { ground, coastDist, emerged, oceanCeiling };
}

/** Distancia con signo: uint8 delta por filas (128 = costa, 1 m por unidad) → metros (Int8). */
function decodeSdf(buf: Uint8Array, w: number): Int8Array {
  const q = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const prev = i % w ? q[i - 1] : i >= w ? q[i - w] : 0;
    q[i] = (prev + buf[i]) & 0xff;
  }
  const out = new Int8Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] - 128;
  return out;
}

/** Nivel del relleno de mar de REMA (mediana de las alturas marcadas como mar). */
function seaLevel(hs: Float32Array, land: Uint8Array | null): number | null {
  if (!land) return null;
  const s: number[] = [];
  for (let i = 0; i < hs.length; i += 97) if (land[i] === 0 && hs[i] === hs[i]) s.push(hs[i]);
  if (s.length < 10) return null;
  s.sort((a, b) => a - b);
  return s[s.length >> 1];
}

// ─── Cavidades y des-cuantización (igual que terreno-nitidez) ─
function cavityShade(hs: Float32Array, w: number, h: number, cell: number): { cavity: Uint8Array; curv: Uint8Array } {
  const W1 = w + 1;
  const sum = new Float64Array(W1 * (h + 1));
  const cnt = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rc = 0;
    for (let x = 0; x < w; x++) {
      const v = hs[y * w + x];
      if (v === v) (rs += v), rc++;
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + rs;
      cnt[(y + 1) * W1 + x + 1] = cnt[y * W1 + x + 1] + rc;
    }
  }
  const radiiM = [8, 24, 64], depthM = [1.5, 4, 10], weight = [0.35, 0.35, 0.3];
  const out = new Uint8Array(w * h);
  // Curvatura con signo: (media del entorno − altura) a 8 y 24 m. Positiva en surcos y hondonadas,
  // negativa en crestas y aristas. Es el relieve REMA, sin datos nuevos.
  const curv = new Uint8Array(w * h).fill(128);
  const crR = [8, 24], crD = [2, 5];
  // Radios en celdas: constantes, se calculan una vez (antes, 5 veces por celda).
  const crCells = crR.map((m) => Math.max(1, Math.round(m / cell))), occCells = radiiM.map((m) => Math.max(1, Math.round(m / cell)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const v = hs[i];
    if (v !== v) { out[i] = 255; continue; }
    let c = 0;
    for (let s = 0; s < 2; s++) {
      const r = crCells[s];
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const S = sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0];
      const C = cnt[y1 * W1 + x1] - cnt[y0 * W1 + x1] - cnt[y1 * W1 + x0] + cnt[y0 * W1 + x0];
      c += 0.5 * Math.max(-1, Math.min(1, (S / C - v) / crD[s]));
    }
    curv[i] = Math.round(128 + c * 127);
    let occ = 0;
    for (let s = 0; s < 3; s++) {
      const r = occCells[s];
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const S = sum[y1 * W1 + x1] - sum[y0 * W1 + x1] - sum[y1 * W1 + x0] + sum[y0 * W1 + x0];
      const C = cnt[y1 * W1 + x1] - cnt[y0 * W1 + x1] - cnt[y1 * W1 + x0] + cnt[y0 * W1 + x0];
      occ += weight[s] * Math.min(1, Math.max(0, (S / C - v) / depthM[s]));
    }
    out[i] = Math.round((1 - 0.55 * occ) * 255);
  }
  return { cavity: out, curv };
}

function dequantize(hs: Float32Array, w: number, h: number, step: number, iterations: number) {
  const lo = new Float32Array(hs.length), hi = new Float32Array(hs.length), tmp = new Float32Array(hs.length);
  for (let i = 0; i < hs.length; i++) (lo[i] = hs[i] - step / 2), (hi[i] = hs[i] + step / 2);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = hs[r + xx];
          if (v === v) (s += v), n++;
        }
        tmp[r + x] = n ? s / n : NaN;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (hs[i] !== hs[i]) continue;
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        const v = tmp[yy * w + x];
        if (v === v) (s += v), n++;
      }
      const m = s / n;
      hs[i] = m < lo[i] ? lo[i] : m > hi[i] ? hi[i] : m;
    }
  }
}

// ─── Alturas para LOD ──────────────────────────────────────
function meshResolution(g: Grid) {
  const { w, h, stride, heights, land } = g;
  const mw = Math.floor((w - 1) / stride) + 1;
  const mh = Math.floor((h - 1) / stride) + 1;
  const meshHeights = new Float32Array(mw * mh);
  const meshLand = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const i = y * stride * w + x * stride;
    const v = heights[i];
    meshHeights[y * mw + x] = v === v ? v : g.sea; // sin dato: al nivel del mar, no a 0
    meshLand[y * mw + x] = Number.isFinite(v) && (!land || land[i]) ? 1 : 0;
  }
  return { meshHeights, meshLand };
}

function emptyMesh(g: Grid) {
  const mw = Math.floor((g.w - 1) / g.stride) + 1;
  const mh = Math.floor((g.h - 1) / g.stride) + 1;
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    index: new Uint32Array(0),
    mesh: { width: mw, height: mh },
  };
}

// ─── Malla ─────────────────────────────────────────────────
// Las alturas se guardan sin exageración. Ambos modos usan el mismo borde abierto.
function readBaked(bytes: Uint8Array, g: Grid) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const u=(i:number)=>v.getUint32(i*4,true);
  const n=u(1), ni=u(2), tiles=u(3), width=u(4),height=u(5);
  if(u(0)!==0x314d5041 || bytes.length!==24+n*12+ni*4+tiles ||
     width!==Math.floor((g.w-1)/g.stride)+1 || height!==Math.floor((g.h-1)/g.stride)+1)
    throw Error("Malla costera incompatible con el relieve");
  const posOffset=bytes.byteOffset+24;
  const source=new Float32Array(bytes.buffer,posOffset,n*3);
  const sourceIndex=new Uint32Array(bytes.buffer,posOffset+n*12,ni);
  const {positions,index,normals}=coastalNormals(source,sourceIndex);
  const tileKinds=bytes.slice(24+n*12+ni*4);
  const uvs=new Float32Array(positions.length/3*2);
  for(let i=0;i<positions.length/3;i++) {
    uvs[i*2]=(positions[i*3]/g.cell+(width-1)*g.stride/2+0.5)/g.w;
    uvs[i*2+1]=(positions[i*3+2]/g.cell+(height-1)*g.stride/2+0.5)/g.h;
  }
  return {positions,index,tileKinds,normals,uvs,mesh:{width,height}};
}

interface VectorCoast {
  nx: number;
  ny: number;
  runs: [number, number][];
  cuts: [number, number[]][];
}

function meshFrom(g: Grid, vector?: VectorCoast) {
  const { w, h, stride, cell, heights, land, sdf } = g;
  const mw = Math.floor((w - 1) / stride) + 1, mh = Math.floor((h - 1) / stride) + 1;
  const halfW = (mw - 1) * stride * cell / 2, halfD = (mh - 1) * stride * cell / 2;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const samples = new Int32Array(w * h).fill(-1);
  const intersections = new Map<number, number>();
  const addDistance = (i: number) => sdf ? sdf[i] : land && !land[i] ? -1 : 1;
  // Si ADD corta una ladera por encima del agua, seguir únicamente muestras REMA emergidas y conectadas a
  // esa tierra hasta la intersección real con el plano (ver groundField).
  const { oceanCeiling } = g;
  const shore = g.emerged ?? new Uint8Array(heights.length);
  const distance = (i: number) => {
    const add = addDistance(i);
    return shore[i] || add >= 0 ? Math.max(add, heights[i] - g.sea) : add;
  };
  function vertex(x: number, y: number, elevation: number) {
    const id = positions.length / 3;
    positions.push(x * cell - halfW, elevation, y * cell - halfD);
    uvs.push((x + 0.5) / w, (y + 0.5) / h);
    return id;
  }
  function sample(i: number) {
    if (samples[i] < 0) samples[i] = vertex(i % w, Math.floor(i / w), heights[i]);
    return samples[i];
  }
  function crossing(i: number, j: number) {
    if (i > j) [i,j] = [j,i];
    const di = distance(i), dj = distance(j);
    if (di === 0) return sample(i);
    if (dj === 0) return sample(j);
    const key = i * heights.length + j;
    const cached = intersections.get(key);
    if (cached !== undefined) return cached;
    let t = di / (di - dj);
    const hi = heights[i], hj = heights[j];
    if (hi + (hj - hi) * t > g.sea && (hi > g.sea) !== (hj > g.sea)) {
      t = (g.sea - hi) / (hj - hi);
    }
    const mix = (a: number, b: number) => a + (b - a) * t;
    const id = vertex(mix(i % w, j % w), mix(Math.floor(i / w), Math.floor(j / w)), mix(heights[i], heights[j]));
    intersections.set(key,id);
    return id;
  }
  function triangle(a: number,b: number,c: number) {
    if (![heights[a], heights[b], heights[c]].every(Number.isFinite)) return;
    const da = distance(a), db = distance(b), dc = distance(c);
    if (Math.max(da,db,dc) <= 0) return;
    if (Math.min(da,db,dc) >= 0) { indices.push(sample(a),sample(b),sample(c)); return; }
    const polygon: number[] = [];
    let prev = c;
    for (const i of [a,b,c]) {
      if ((distance(prev) > 0) !== (distance(i) > 0)) polygon.push(crossing(prev,i));
      if (distance(i) > 0) polygon.push(sample(i));
      prev = i;
    }
    for (let j=1; j+1<polygon.length; j++) {
      if (polygon[0] !== polygon[j] && polygon[j] !== polygon[j+1] && polygon[j+1] !== polygon[0])
        indices.push(polygon[0],polygon[j],polygon[j+1]);
    }
  }
  const cellLand = vector ? new Uint8Array(vector.nx * vector.ny) : null;
  if (vector && (vector.nx !== mw-1 || vector.ny !== mh-1)) throw Error("Grilla ADD incompatible");
  for (const [first,count] of vector?.runs ?? []) cellLand!.fill(1, first, first+count);
  const cuts = new Map(vector?.cuts);
  const shared = new Map<string,number>();
  function emitVectorCell(x: number,y: number) {
    const id=(y/stride)*(mw-1)+x/stride, a=y*w+x, b=a+w*stride;
    const faces=cuts.get(id);
    // No salvar huecos NoData mediante un triángulo de resolución más gruesa.
    for(let dy=0;dy<=stride;dy++) for(let dx=0;dx<=stride;dx++)
      if(!Number.isFinite(heights[a+dy*w+dx])) return;
    if (!faces) {
      if (cellLand![id]) indices.push(sample(a),sample(b),sample(a+stride),sample(b),sample(b+stride),sample(a+stride));
      return;
    }
    for(let j=0;j<faces.length;j+=7){
      const ids:number[]=[];
      for(let k=1;k<7;k+=2){
        const u=faces[j+k],v=faces[j+k+1],px=x+stride*u,py=y+stride*v;
        const key=Math.round(px*1e7)+","+Math.round(py*1e7);
        let id=shared.get(key);
        if(id===undefined){
          // Both sides of an edge use the original two mesh endpoints.
          const h=faces[j]===2 ? heights[a]*(1-v)+heights[b]*(v-u)+heights[b+stride]*u :
            faces[j]===3 ? heights[a]*(1-u)+heights[b+stride]*v+heights[a+stride]*(u-v) :
            faces[j]===0 ? heights[a]*(1-u-v)+heights[a+stride]*u+heights[b]*v :
            heights[b]*(1-u)+heights[a+stride]*(1-v)+heights[b+stride]*(u+v-1);
          id=vertex(px,py,h);shared.set(key,id);
        }
        ids.push(id);
      }
      indices.push(...ids);
    }
  }
  const tileKinds: number[] = [];
  if (SEABED && !vector) {
    // Costa por intersección con el plano del mar, sin recortar triángulos (el recorte dejaba
    // "dientes": bordes a la altura de la cresta y vértices de mar en el relleno de REMA).
    // Las celdas de costa y las de mar a menos de SEABED_APRON_M se dibujan enteras: la tierra queda
    // sobre el mar y el fondo baja con la distancia a la costa. El fondo es una reconstrucción
    // artística (no hay batimetría en este recorte); se ve a través del agua cerca de la orilla.
    // Muestras emergidas (G): tierra ADD, o REMA emergido y conectado a tierra donde la costa ADD queda tierra
    // adentro (en Brown, un acantilado de 100 m a más de 12 m de la línea ADD). La línea de agua de la malla es
    // el borde de G con el relleno de mar de REMA, y el fondo baja con la distancia a ESE borde (Dn, chamfer a
    // resolución nativa), igual en esquinas de 8 m y en las muestras de 4 m de las celdas de costa. Antes el
    // fondo usaba la distancia a la costa ADD y las muestras de 4 m el nivel del relleno: junto a ese acantilado
    // alternaban esquinas a −28 m con muestras a −2 m y la orilla salía en cuñas (dientes de sierra).
    const G = g.ground ?? new Uint8Array(w * h).fill(1);
    const CD = g.coastDist ?? new Float32Array(w * h).fill(12); // m, + emergido
    // Fondo (reconstrucción artística): 1,5 m en la orilla, 30 m al final de la franja; nunca por encima del
    // relleno de REMA (si el relleno está más bajo, manda el relleno: continuidad con la malla anterior).
    const depthAt = (i: number) => {
      let zz = g.sea - Math.min(SEABED_MAX_M, 1.5 + Math.max(0, -CD[i]) * SEABED_SLOPE);
      const v = heights[i];
      if (Number.isFinite(v) && v < zz) zz = v;
      return zz;
    };
    const z = new Float32Array(mw * mh), isLand = new Uint8Array(mw * mh), near = new Uint8Array(mw * mh), hole = new Uint8Array(mw * mh);
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
      const m = my * mw + mx, i = my * stride * w + mx * stride, v = heights[i];
      if (!Number.isFinite(v)) { hole[m] = 1; continue; } // hueco sin dato tierra adentro
      if (G[i] === 1) { isLand[m] = 1; near[m] = 1; z[m] = v; continue; }
      near[m] = -CD[i] < SEABED_APRON_M ? 1 : 0;
      z[m] = depthAt(i);
    }
    // Costa sin escalones (dientes de sierra): la grilla (8 m; 4 m en las celdas que cruzan el agua) no sigue
    // la línea de costa, y la línea de agua salía escalonada; en un acantilado el frente quedaba plegado (cada
    // escalón de 4 m, una cuña blanca). Los vértices de la primera fila a cada lado de la costa se corren en
    // horizontal, por el gradiente de la distancia con signo, hasta 0,3 m de la línea (emergido +0,3 · mar −0,3),
    // con desvanecimiento hacia la segunda fila (sin saltos entre vecinos). La altura no cambia (REMA intacto),
    // la uv sigue al vértice y no se agregan vértices. Quedan fijos los vértices del borde de un bloque cuando el
    // bloque vecino lo dibuja el LOD instanciado (plantilla con posiciones nativas): si se movieran, se abriría
    // una grieta. Los bloques de fondo de 2×2 no se arman sobre vértices desplazados.
    const tw = Math.ceil((mw - 1) / TILE), th = Math.ceil((mh - 1) / TILE);
    const kinds = new Uint8Array(tw * th);
    for (let row = 0; row < mh - 1; row += TILE) for (let col = 0; col < mw - 1; col += TILE) {
      const r1 = Math.min(row + TILE, mh - 1), c1 = Math.min(col + TILE, mw - 1);
      let inside = false, outside = false, apron = false;
      for (let y = row; y <= r1; y++) for (let x = col; x <= c1; x++) {
        const m = y * mw + x;
        if (isLand[m] && z[m] > g.sea) inside = true; else { outside = true; if (near[m]) apron = true; }
      }
      for(let y=row*stride;y<=r1*stride && !outside;y++)for(let x=col*stride;x<=c1*stride;x++)
        if(!Number.isFinite(heights[y*w+x]))outside=true;
      kinds[(row / TILE) * tw + col / TILE] = !inside && !apron ? 0 : inside && !outside ? 1 : 2;
    }
    const span = stride * TILE; // celdas nativas por bloque
    const coastTile = (tc: number, tr: number) => tc >= 0 && tr >= 0 && tc < tw && tr < th && kinds[tr * tw + tc] === 2;
    const movable = (x: number, y: number) => {
      // el perímetro del recorte queda fijo: ahí se apoyan el cierre exterior (close-coast) y el terreno exterior
      if (x <= 0 || y <= 0 || x >= (mw - 1) * stride || y >= (mh - 1) * stride) return false;
      const bx = x % span === 0, by = y % span === 0;
      if (!bx && !by) return true;
      const c0 = Math.floor(x / span), r0 = Math.floor(y / span);
      const cs = bx ? [c0 - 1, c0] : [c0], rs = by ? [r0 - 1, r0] : [r0];
      return cs.every((tc) => rs.every((tr) => coastTile(tc, tr)));
    };
    // La línea de agua de la malla es el borde entre muestras emergidas (tierra ADD, o REMA emergido y conectado
    // donde la costa ADD queda tierra adentro: en Brown, un acantilado de 100 m a más de 12 m de la línea ADD)
    // y el relleno de mar de REMA. Ese borde es una escalera de la grilla; suavizado con dos pasadas de caja 3×3
    // da una distancia con signo aproximada (celdas, + emergido, válida hasta ±1,5 celdas) cuya curva de cero
    // pasa por el medio de los escalones: los vértices se corren hasta ella. (La distancia ADD no sirve aquí:
    // satura a ±12 m y en los acantilados no coincide con el borde del relleno.)
    const GAP = 0.3 / cell; // celdas nativas
    const coastOffset = (x: number, y: number): [number, number] => {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return [0, 0];
      const i = y * w + x, d = CD[i] / cell, ad = Math.abs(d); // celdas (borde suavizado hasta ±1,4)
      // completo en la primera fila a cada lado (≤ 0,75 celdas), nada desde 1,25: la segunda fila no se arrastra
      const fade = Math.min(1, Math.max(0, (1.25 - ad) / 0.5));
      if (ad <= GAP || fade <= 0 || !movable(x, y)) return [0, 0];
      const gx = (CD[i + 1] - CD[i - 1]) / cell, gy = (CD[i + w] - CD[i - w]) / cell, len = Math.hypot(gx, gy);
      if (len < 0.3) return [0, 0];
      const s = (d - Math.sign(d) * GAP) * fade;
      return [(-gx / len) * s, (-gy / len) * s];
    };
    const offX = new Float32Array(mw * mh), offZ = new Float32Array(mw * mh);
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
      const m = my * mw + mx;
      if (!hole[m]) [offX[m], offZ[m]] = coastOffset(mx * stride, my * stride);
    }
    const ids = new Int32Array(mw * mh).fill(-1);
    const moved = new Map<number, [number, number]>(); // id de vértice desplazado → celda nativa de origen
    const corner = (m: number) => {
      if (ids[m] >= 0) return ids[m];
      const x = (m % mw) * stride, y = Math.floor(m / mw) * stride;
      ids[m] = vertex(x + offX[m], y + offZ[m], z[m]);
      if (offX[m] || offZ[m]) moved.set(ids[m], [x, y]);
      return ids[m];
    };
    const fineIds=new Map<number,number>();
    const nativeVertex=(x:number,y:number)=>{
      if(x%stride===0&&y%stride===0)return corner((y/stride)*mw+x/stride);
      const i=y*w+x,cached=fineIds.get(i);if(cached!==undefined)return cached;
      const elevation=G[i]===1?heights[i]:depthAt(i); // mismo fondo que las esquinas
      const [ox,oy]=coastOffset(x,y);
      const id=vertex(x+ox,y+oy,elevation);fineIds.set(i,id);
      if(ox||oy)moved.set(id,[x,y]);
      return id;
    };
    const firstIndex = indices.length;
    for (let row = 0; row < mh - 1; row += TILE) for (let col = 0; col < mw - 1; col += TILE) {
      const r1 = Math.min(row + TILE, mh - 1), c1 = Math.min(col + TILE, mw - 1);
      const kind = kinds[(row / TILE) * tw + col / TILE];
      tileKinds.push(kind);
      if (!(kind === 2 || (g.full && kind === 1))) continue;
      const cellQuad = (x: number, y: number, s: number) => {
        const a = y * mw + x, b = a + s * mw, c = b + s, d = a + s;

        if (!(near[a] || near[b] || near[c] || near[d])) return;
        // Refine only crossing cells with native DEM samples. Split a shared edge
        // iff its endpoints straddle water, so the adjacent cell makes the same split.
        if(s===1 && stride===2 && !hole[a]&&!hole[b]&&!hole[c]&&!hole[d]){
          const grid=[a,b,c,d],wet=grid.map(i=>z[i]<=g.sea);
          const sx=x*stride,sy=y*stride,mid=(sy+1)*w+sx+1;
          if(wet.some(Boolean)&&wet.some(v=>!v)&&Number.isFinite(heights[mid])){
            const xy=[[sx,sy],[sx,sy+2],[sx+2,sy+2],[sx+2,sy]],ring:number[]=[];
            let valid=true;
            for(let k=0;k<4;k++)if(wet[k]!==wet[(k+1)%4]){
              const next=xy[(k+1)%4],cur=xy[k];
              if(!Number.isFinite(heights[((cur[1]+next[1])/2)*w+(cur[0]+next[0])/2]))valid=false;
            }
            if(valid){
              for(let k=0;k<4;k++){
                const cur=xy[k],next=xy[(k+1)%4];ring.push(corner(grid[k]));
                if(wet[k]!==wet[(k+1)%4])ring.push(nativeVertex((cur[0]+next[0])/2,(cur[1]+next[1])/2));
              }
              const center=nativeVertex(sx+1,sy+1);
              for(let k=0;k<ring.length;k++)indices.push(ring[k],ring[(k+1)%ring.length],center);
              return;
            }
          }
          // Pick the diagonal supported by the measured cell centre.
          if(Number.isFinite(heights[mid]) && Math.abs((z[a]+z[c])/2-heights[mid])+.5<Math.abs((z[b]+z[d])/2-heights[mid])){
            indices.push(corner(a),corner(b),corner(c),corner(a),corner(c),corner(d));return;
          }
        }
        if(hole[b] || hole[d]){
          if(!hole[a] && !hole[b] && !hole[c])indices.push(corner(a),corner(b),corner(c));
          if(!hole[a] && !hole[c] && !hole[d])indices.push(corner(a),corner(c),corner(d));
        }else{
          if(!hole[a])indices.push(corner(a),corner(b),corner(d));
          if(!hole[c])indices.push(corner(b),corner(c),corner(d));
        }
      };
      // Fondo enteramente bajo el agua: bloques de 2×2 celdas (16 m). La costa sigue a 8 m.
      for (let y = row; y < r1; y += 2) for (let x = col; x < c1; x += 2) {
        let seaBlock = y + 2 <= r1 && x + 2 <= c1;
        for (let dy = 0; dy <= 2 && seaBlock; dy++) for (let dx = 0; dx <= 2; dx++) {
          const m = (y + dy) * mw + x + dx;
          // un vértice desplazado en el medio de un lado abriría una grieta con las celdas finas vecinas
          if (isLand[m] || hole[m] || offX[m] || offZ[m]) { seaBlock = false; break; }
        }
        if (seaBlock) { cellQuad(x, y, 2); continue; }
        for (let yy = y; yy < Math.min(y + 2, r1); yy++) for (let xx = x; xx < Math.min(x + 2, c1); xx++) cellQuad(xx, yy, 1);
      }
    }
    // Sin pliegues: si un triángulo quedó invertido o casi sin área en planta por los desplazamientos, sus
    // vértices vuelven a la grilla (pocas decenas por base). Las tiras de 0,6 m entre el vértice de tierra y el
    // de mar, ambos junto a la línea, son válidas: el umbral es el 2 % del área original.
    const gridX = (id: number) => moved.has(id) ? moved.get(id)![0] * cell - halfW : positions[id * 3];
    const gridZ = (id: number) => moved.has(id) ? moved.get(id)![1] * cell - halfD : positions[id * 3 + 2];
    for (let pass = 0; pass < 4 && moved.size; pass++) {
      let reset = 0;
      for (let k = firstIndex; k < indices.length; k += 3) {
        const a = indices[k], b = indices[k + 1], c = indices[k + 2];
        if (!moved.has(a) && !moved.has(b) && !moved.has(c)) continue;
        const area = (positions[b * 3] - positions[a * 3]) * (positions[c * 3 + 2] - positions[a * 3 + 2]) - (positions[b * 3 + 2] - positions[a * 3 + 2]) * (positions[c * 3] - positions[a * 3]);
        const before = (gridX(b) - gridX(a)) * (gridZ(c) - gridZ(a)) - (gridZ(b) - gridZ(a)) * (gridX(c) - gridX(a));
        // también las caras que en precisión GPU quedarían verticales (área en planta ~0): no son cierres
        if (area * Math.sign(before) > 0.02 * Math.abs(before) && Math.abs(area) > 0.01) continue;
        for (const v of [a, b, c]) {
          const o = moved.get(v);
          if (o === undefined) continue;
          const [x, y] = o;
          positions[v * 3] = x * cell - halfW; positions[v * 3 + 2] = y * cell - halfD;
          uvs[v * 2] = (x + 0.5) / w; uvs[v * 2 + 1] = (y + 0.5) / h;
          moved.delete(v); reset++;
        }
      }
      if (!reset) break;
    }
    // El vértice más alto de cada triángulo va último (vértice "provoking" del varying `flat` vTopY): así el
    // fragment conoce la altura de la cima de la cara y pinta de roca todo el frente de un acantilado, también
    // sus 6–12 m más bajos (antes salían de nieve: cada cinta vertical asomaba como un diente blanco).
    for (let k = firstIndex; k < indices.length; k += 3) {
      const a = indices[k], b = indices[k + 1], c = indices[k + 2];
      const ya = positions[a * 3 + 1], yb = positions[b * 3 + 1], yc = positions[c * 3 + 1];
      if (ya >= yb && ya >= yc) { indices[k] = b; indices[k + 1] = c; indices[k + 2] = a; }
      else if (yb >= yc) { indices[k] = c; indices[k + 1] = a; indices[k + 2] = b; }
    }
  } else
  for (let row=0; row<mh-1; row+=TILE) for (let col=0; col<mw-1; col+=TILE) {
    const x0 = col*stride, y0=row*stride;
    const x1=Math.min(col+TILE,mw-1)*stride, y1=Math.min(row+TILE,mh-1)*stride;
    let inside=false, outside=false;
    if (vector) {
      for(let y=row;y<y1/stride;y++) for(let x=col;x<x1/stride;x++) {
        const id=y*(mw-1)+x;
        const faces=cuts.get(id);
        if(faces ? faces.length>0 : cellLand![id]!==0) inside=true;
        if(faces || !cellLand![id]) outside=true;
      }
      for(let y=y0;y<=y1 && !outside;y++) for(let x=x0;x<=x1;x++)
        if(!Number.isFinite(heights[y*w+x])) outside=true;
      tileKinds.push(!inside ? 0 : outside ? 2 : 1);
      if(inside && (g.full || outside))
        for(let y=y0;y<y1;y+=stride) for(let x=x0;x<x1;x+=stride) emitVectorCell(x,y);
      continue;
    }
    for(let y=y0; y<=y1 && !(inside && outside); y++) for(let x=x0;x<=x1;x++) {
      const i=y*w+x;
      if(Number.isFinite(heights[i]) && distance(i)>0) inside=true; else outside=true;
    }
    tileKinds.push(!inside ? 0 : outside ? 2 : 1);
    if (!inside || (!g.full && !outside)) continue;
    // Conservar el muestreo de la malla en tierra firme. Refinar a resolución
    // ADD sólo las celdas que tocan la costa o un hueco de datos.
    for (let y=y0; y<y1; y+=stride) for (let x=x0; x<x1; x+=stride) {
      const a=y*w+x, b=a+stride*w;
      let refine=false;
      if (outside) {
        let valid=0;
        for (let dy=0;dy<=stride;dy++) for(let dx=0;dx<=stride;dx++) {
          const i=a+dy*w+dx;
          if (distance(i)>0 && Number.isFinite(heights[i])) valid++;
        }
        if (!valid) continue;
        refine=valid<(stride+1)*(stride+1);
      }
      if (!refine) {
        triangle(a,b,a+stride);
        triangle(b,b+stride,a+stride);
      } else {
        for(let dy=0;dy<stride;dy++) for(let dx=0;dx<stride;dx++) {
          const i=a+dy*w+dx;
          triangle(i,i+w,i+1);
          triangle(i+w,i+w+1,i+1);
        }
      }
    }
  }
  const gpuPositions = Float32Array.from(positions);
  if (vector) {
    // Intersecciones submilimétricas pueden colapsar al convertir a precisión GPU.
    let count = 0;
    for (let j = 0; j < indices.length; j += 3) {
      const a = 3*indices[j], b = 3*indices[j+1], c = 3*indices[j+2];
      const p = gpuPositions;
      const area = (p[b+2]-p[a+2])*(p[c]-p[a]) - (p[b]-p[a])*(p[c+2]-p[a+2]);
      if (area <= 0) continue;
      indices[count++] = indices[j]; indices[count++] = indices[j+1]; indices[count++] = indices[j+2];
    }
    indices.length = count;
  }
  const normals = new Float32Array(positions.length);
  for(let i=1;i<normals.length;i+=3) normals[i]=1; // normales de iluminación en uSurface
  return {positions:gpuPositions, normals, uvs:Float32Array.from(uvs),
    index:Uint32Array.from(indices), mesh:{width:mw,height:mh}, tileKinds:Uint8Array.from(tileKinds)};
}

// ─── Decodificación ────────────────────────────────────────
async function gunzipMaybe(buf: ArrayBuffer): Promise<Uint8Array> {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function decodeDeltaPlanar(buf: Uint8Array, w: number): Uint16Array {
  const n = buf.length / 2;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const d = (buf[i] << 8) | buf[n + i];
    const prev = i % w ? out[i - 1] : i >= w ? out[i - w] : 0;
    out[i] = (prev + d) & 0xffff;
  }
  return out;
}
