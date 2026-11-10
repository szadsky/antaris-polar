import * as THREE from "three";
import type { BuiltMsg, UpdatedMsg, Vec3 } from "./worker";
import { baseMaterial, seaPlaneMaterial, styleUniforms, stylizedMaterial, type GridUniforms, type MaterialVariant } from "./shaders";
import { detailTexture, noiseTexture } from "./materials";
import { detailTextureCorrected } from "./detail-corrected";
import { ChunkedTerrain, STEPS, type LodStats } from "./lod";

export interface Level {
  name: string;
  file: string;
  maskFile: string | null;
  /** Aligned measured coverage, same dimensions, encoding, origin and datum. */
  coverageFile?: string;
  width: number;
  height: number;
  cellSizeM: number;
  transferBytes: number;
}

export interface TerrainMeta {
  id: string;
  base: { id: string; nombre: string; lat: number; lon: number; projected: [number, number] };
  geoid: { egm2008: number; egm96: number } | null;
  origin: [number, number];
  original: { width: number; height: number; resolutionM: number };
  heights: { minM: number; maxM: number; stepM: number };
  levels: Level[];
  fuentes: { relieve: string; relieveCita: string | null; costa: string | null; base: string };
}

export type Style = "base" | "estilizado";
/** "lod": bloques con nivel de detalle (fase 2). "completa": malla única de la fase 1 (para medir el antes). */
export type GeoMode = "lod" | "completa";

export interface Terrain {
  object: THREE.Object3D;
  geo: GeoMode;
  level: Level;
  heightsM: Float32Array;
  provenance: BuiltMsg["provenance"];
  /** Stable source grid for future material/environment layers, separate from LOD. */
  grid: {width:number;height:number;cellSizeM:number;origin:[number,number];heightOffsetM:number;crs:"EPSG:3031"};
  widthM: number;
  depthM: number;
  seaLevelM: number | null;
  meshSize: { width: number; height: number };
  /** Material del plano del mar en modo LOD (null en modo completa). */
  seaMaterial: THREE.Material | null;
  ms: { fetch: number; decode: number; surface: number; light: number; mesh: number };
  gpuBytes(): { geometry: number; textures: number };
  lodStats(): LodStats | null;
  /** Llamar antes de dibujar si la cámara cambió (elige bloques y niveles). */
  beforeRender(camera: THREE.PerspectiveCamera, viewportHeightPx: number): void;
  setStyle(s: Style): void;
  /** Fase 3A: activa/desactiva el detalle de cerca (interpretación). */
  setDetail(on: boolean): void;
  /** Fase 4: densidad del LOD (px por celda en pantalla). Sin efecto en modo completa. */
  setLodTarget(px: number): void;
  /** Prueba de materiales A/B/C (solo afecta al estilo Interpretación). */
  setVariant(v: MaterialVariant): void;
  /** Uniforms del estilo (diagnóstico por capas). */
  styleUniforms: ReturnType<typeof styleUniforms>;
  update(k: number): Promise<{ lightMs: number }>;
  dispose(): void;
}

export const MESH_STRIDE = 2;

export class TerrainLoader {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private waiting = new Map<number, {resolve:(m:BuiltMsg|UpdatedMsg)=>void;reject:(e:Error)=>void}>();
  private nextKey=0;
  private nextRequest=0;

  constructor(private sun: Vec3) {
    this.worker.onerror=(e)=>{for(const p of this.waiting.values())p.reject(new Error(e.message));this.waiting.clear();};
    this.worker.onmessage = (e:MessageEvent<BuiltMsg|UpdatedMsg|{type:'error';key:string;requestId?:number;message:string}>)=>{
      const m=e.data;if(m.requestId===undefined)return;const pending=this.waiting.get(m.requestId);this.waiting.delete(m.requestId);
      if(m.type==='error')pending?.reject(new Error(m.message));else pending?.resolve(m);
    };
  }

  private call<T extends BuiltMsg | UpdatedMsg>(reply: T["type"], payload: { type: string; key: string; [k: string]: unknown }, transfer: Transferable[] = []) {
    const requestId=++this.nextRequest;
    return new Promise<T>((resolve,reject) => {
      this.waiting.set(requestId, {resolve:resolve as (m: BuiltMsg | UpdatedMsg) => void,reject});
      this.worker.postMessage({...payload,requestId}, transfer);
    });
  }

  async load(dir: string, meta: TerrainMeta, level: Level, k: number, style: Style, maxAniso: number, geo: GeoMode): Promise<Terrain> {
    const t0 = performance.now();
    // Costa: distancia con signo a la costa ADD (scripts/costa-sdf.mjs); si falta, la máscara binaria.
    const coast = async () => {
      const r = await fetch(`${dir}/costa-${level.name}.sdf.gz`);
      if (r.ok) return { sdf: await r.arrayBuffer(), mask: null };
      return { sdf: null, mask: level.maskFile ? await get(`${dir}/${level.maskFile}`) : null };
    };
    const [bin, { sdf, mask }, vector,coverage] = await Promise.all([get(`${dir}/${level.file}`), coast(), (geo === "completa" ? getOptional : get)(`${dir}/malla-${level.name}-${geo}.bin.gz`),level.coverageFile?get(`${dir}/${level.coverageFile}`):Promise.resolve(null)]);
    const fetchMs = performance.now() - t0;
    const key = `${dir}/${level.file}:${++this.nextKey}`;
    const b = await this.call<BuiltMsg>(
      "built",
      { type: "build", seaDatum: meta.geoid ? meta.geoid.egm2008 - meta.heights.minM : null, key, bin, mask, coverage, baked: vector, width: level.width, height: level.height, cellSizeM: level.cellSizeM, stepM: meta.heights.stepM, stride: MESH_STRIDE, exaggeration: k, sun: this.sun, full: geo === "completa", sdf },
      [bin,...(coverage?[coverage]:[]), ...(vector ? [vector] : []), ...(mask ? [mask] : []), ...(sdf ? [sdf] : [])]
    );

    const dataTex = (data: Uint8Array, w: number, h: number) => {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = maxAniso;
      t.needsUpdate = true;
      return t;
    };
    const surface = dataTex(b.surface, level.width, level.height);
    const light = dataTex(b.light, b.mesh.width, b.mesh.height);
    const tex = { surface, light };
    detailTexture().anisotropy = maxAniso; // antes 8 fijo
    detailTextureCorrected().anisotropy = maxAniso;
    noiseTexture().anisotropy = maxAniso;
    let variant: MaterialVariant = "a";
    const meshCell = level.cellSizeM * MESH_STRIDE;
    // Media del ancho del recorte a resolución de malla (coincide con la posición de los vértices).
    const halfW = ((b.mesh.width - 1) * meshCell) / 2;
    const halfD = ((b.mesh.height - 1) * meshCell) / 2;
    const seaRel = b.seaLevelM ?? 0;
    const su = styleUniforms(tex, { halfSize: [halfW, halfD], seaY: seaRel * k });
    let style_ = style;

    // ─── Modo completa (fase 1) ───
    {
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(new THREE.BufferAttribute(b.index, 1));
      geometry.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
      geometry.setAttribute("surfUv", new THREE.BufferAttribute(b.uvs, 2));
      geometry.computeBoundingSphere();
      const styl = { a: stylizedMaterial(su, { exactCoast: !!vector, variant: "a" }), b: stylizedMaterial(su, { exactCoast: !!vector, variant: "b" }), c: stylizedMaterial(su, { exactCoast: !!vector, variant: "c" }), n: stylizedMaterial(su, { exactCoast: !!vector, variant: "n" }) };
      const pick = (s: Style) => (s === "base" ? baseMat : styl[variant]);
      const baseMat = baseMaterial(tex, {exactCoast: !!vector});
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, pick(style));
      mesh.name = "terreno-rema";
      mesh.scale.y = k;
      const waterGrid = {
        uGridSize: {value: new THREE.Vector2(b.mesh.width,b.mesh.height)},
        uTexSize: {value: new THREE.Vector2(level.width,level.height)},
        uCell: {value:meshCell}, uStride:{value:MESH_STRIDE},
      };
      const geomBytes = b.index.byteLength + b.positions.byteLength + b.normals.byteLength + b.uvs.byteLength;
      if (geo === "completa") {
      const water = seaPlaneMaterial(su, waterGrid);
      return {
        object: mesh, geo, level, heightsM: b.heightsM,provenance:b.provenance,grid:{width:level.width,height:level.height,cellSizeM:level.cellSizeM,origin:meta.origin,heightOffsetM:meta.heights.minM,crs:"EPSG:3031"}, widthM: halfW * 2, depthM: halfD * 2, seaLevelM: b.seaLevelM,
        meshSize: b.mesh, seaMaterial: water, ms: { fetch: fetchMs, ...b.ms },
        gpuBytes: () => ({ geometry: geomBytes, textures: Math.round((b.surface.byteLength + b.light.byteLength) * (4 / 3)) }),
        lodStats: () => null,
        beforeRender: () => {},
        setStyle: (s) => ((style_ = s), (mesh.material = pick(s))),
        setVariant: (v) => ((variant = v), (mesh.material = pick(style_))),
        styleUniforms: su,
        setDetail: (on) => (su.uDetailOn.value = on ? 1 : 0),
        setLodTarget: () => {},
        update: async (kk) => {
          const r = await this.call<UpdatedMsg>("updated", { type: "update", key, exaggeration: kk, sun: this.sun });
          mesh.scale.y = kk;
          surface.image.data = r.surface;
          surface.needsUpdate = true;
          light.image.data = r.light;
          light.needsUpdate = true;
          su.uSeaY.value = seaRel * kk;
          return { lightMs: r.ms.light };
        },
        dispose: () => {
          this.worker.postMessage({type:"release",key});
          water.dispose();
          geometry.dispose();
          baseMat.dispose();
          Object.values(styl).forEach((m) => m.dispose());
          surface.dispose();
          light.dispose();
        },
      };
    }

    // ─── Modo LOD (fase 2) ───
    const heightTex = new THREE.DataTexture(b.meshHeights, b.mesh.width, b.mesh.height, THREE.RedFormat, THREE.FloatType);
    heightTex.minFilter = heightTex.magFilter = THREE.NearestFilter;
    heightTex.generateMipmaps = false;
    heightTex.needsUpdate = true;
    const grid: GridUniforms = {
      uHeight: { value: heightTex },
      uGridSize: { value: new THREE.Vector2(b.mesh.width, b.mesh.height) },
      uTexSize: { value: new THREE.Vector2(level.width, level.height) },
      uCell: { value: meshCell },
      uStride: { value: MESH_STRIDE },
      uK: { value: k },
    };
    // Faldón por nivel: proporcional al paso (cubre la diferencia entre niveles vecinos).
    const skirts = STEPS.map((s) => ({ value: (s * meshCell * 1.5 + 5) * k }));
    const lodStyl = (vr: MaterialVariant) => STEPS.map((_, i) => stylizedMaterial(su, { exactCoast: !!vector, grid, skirt: skirts[i], far: i >= 2, variant: vr }));
    const baseMats = STEPS.map((_, i) => baseMaterial(tex, { exactCoast: !!vector, grid, skirt: skirts[i] }));
    const stylMats = { a: lodStyl("a"), b: lodStyl("b"), c: lodStyl("c"), n: lodStyl("n") };
    const lodPick = (s: Style) => (s === "base" ? baseMats : stylMats[variant]);
    const chunked = new ChunkedTerrain(b.meshHeights, b.meshLand, b.tileKinds, b.mesh.width, b.mesh.height, meshCell, lodPick(style), k, !!vector);
    chunked.group.add(mesh);
    chunked.skipSea = style === "estilizado";
    const seaMat = seaPlaneMaterial(su, grid);
    return {
      object: chunked.group, geo, level, heightsM: b.heightsM,provenance:b.provenance,grid:{width:level.width,height:level.height,cellSizeM:level.cellSizeM,origin:meta.origin,heightOffsetM:meta.heights.minM,crs:"EPSG:3031"}, widthM: halfW * 2, depthM: halfD * 2, seaLevelM: b.seaLevelM,
      meshSize: b.mesh, seaMaterial: seaMat, ms: { fetch: fetchMs, ...b.ms },
      gpuBytes: () => ({
        geometry: geomBytes + chunked.geometryBytes(),
        textures: Math.round((b.surface.byteLength + b.light.byteLength) * (4 / 3)) + b.meshHeights.byteLength,
      }),
      lodStats: () => chunked.stats,
      beforeRender: (camera, h) => chunked.update(camera, h),
      setDetail: (on) => (su.uDetailOn.value = on ? 1 : 0),
      setLodTarget: (px) => (chunked.targetPx = px),
      styleUniforms: su,
      setVariant: (v) => {
        variant = v;
        mesh.material = pick(style_);
        chunked.setMaterials(lodPick(style_));
      },
      setStyle: (s) => {
        style_ = s;
        mesh.material = pick(s);
        chunked.setMaterials(lodPick(s));
        // En Base el terreno dibuja su mar (sin plano); en la interpretación el agua es del plano.
        chunked.skipSea = s === "estilizado";
      },
      update: async (kk) => {
        mesh.scale.y = kk;
        grid.uK.value = kk; // sin rehacer vértices
        skirts.forEach((sk, i) => (sk.value = (STEPS[i] * meshCell * 1.5 + 5) * kk));
        chunked.setExaggeration(kk);
        su.uSeaY.value = seaRel * kk;
        const r = await this.call<UpdatedMsg>("updated", { type: "update", key, exaggeration: kk, sun: this.sun });
        surface.image.data = r.surface;
        surface.needsUpdate = true;
        light.image.data = r.light;
        light.needsUpdate = true;
        void style_;
        return { lightMs: r.ms.light };
      },
      dispose: () => {
          this.worker.postMessage({type:"release",key});
        geometry.dispose();
        baseMat.dispose();
        Object.values(styl).forEach(m => m.dispose());
        chunked.dispose();
        [...baseMats, ...stylMats.a, ...stylMats.b, ...stylMats.c, ...stylMats.n, seaMat].forEach((m) => m.dispose());
        surface.dispose();
        light.dispose();
        heightTex.dispose();
      },
    };
    }
  }
}

/** Malla única de depuración (?geo=completa): ya no se publica; si falta, el worker la arma en el navegador. */
async function getOptional(url: string) {
  const r = await fetch(url);
  // Vite y muchos hostings responden un archivo inexistente con la página HTML (200), no con 404.
  if (!r.ok || (r.headers.get("content-type") ?? "").includes("text/html")) return undefined;
  return r.arrayBuffer();
}

async function get(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falta ${url}`);
  return r.arrayBuffer();
}
