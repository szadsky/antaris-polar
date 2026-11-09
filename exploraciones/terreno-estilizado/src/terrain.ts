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
  private waiting = new Map<string, (m: BuiltMsg | UpdatedMsg) => void>();

  constructor(private sun: Vec3) {
    this.worker.onmessage = (e: MessageEvent<BuiltMsg | UpdatedMsg | { type: "error"; message: string }>) => {
      const m = e.data;
      if (m.type === "error") return console.error("Worker:", m.message);
      const k = `${m.type}:${m.key}`;
      this.waiting.get(k)?.(m);
      this.waiting.delete(k);
    };
  }

  private call<T extends BuiltMsg | UpdatedMsg>(reply: T["type"], payload: { type: string; key: string; [k: string]: unknown }, transfer: Transferable[] = []) {
    return new Promise<T>((resolve) => {
      this.waiting.set(`${reply}:${payload.key}`, resolve as (m: BuiltMsg | UpdatedMsg) => void);
      this.worker.postMessage(payload, transfer);
    });
  }

  async load(dir: string, meta: TerrainMeta, level: Level, k: number, style: Style, maxAniso: number, geo: GeoMode): Promise<Terrain> {
    const t0 = performance.now();
    const [bin, mask] = await Promise.all([get(`${dir}/${level.file}`), level.maskFile ? get(`${dir}/${level.maskFile}`) : null]);
    const fetchMs = performance.now() - t0;
    const key = `${dir}/${level.file}`;
    const b = await this.call<BuiltMsg>(
      "built",
      { type: "build", key, bin, mask, width: level.width, height: level.height, cellSizeM: level.cellSizeM, stepM: meta.heights.stepM, stride: MESH_STRIDE, exaggeration: k, sun: this.sun, full: geo === "completa" },
      mask ? [bin, mask] : [bin]
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
    if (geo === "completa") {
      const geometry = new THREE.BufferGeometry();
      geometry.setIndex(new THREE.BufferAttribute(b.index, 1));
      geometry.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
      geometry.setAttribute("surfUv", new THREE.BufferAttribute(b.uvs, 2));
      geometry.computeBoundingSphere();
      const styl = { a: stylizedMaterial(su, { variant: "a" }), b: stylizedMaterial(su, { variant: "b" }), c: stylizedMaterial(su, { variant: "c" }), n: stylizedMaterial(su, { variant: "n" }) };
      const pick = (s: Style) => (s === "base" ? baseMat : styl[variant]);
      const baseMat = baseMaterial(tex);
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, pick(style));
      mesh.name = "terreno-rema";
      const geomBytes = b.index.byteLength + b.positions.byteLength + b.normals.byteLength + b.uvs.byteLength;
      return {
        object: mesh, geo, level, heightsM: b.heightsM, widthM: halfW * 2, depthM: halfD * 2, seaLevelM: b.seaLevelM,
        meshSize: b.mesh, seaMaterial: null, ms: { fetch: fetchMs, ...b.ms },
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
          geometry.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
          geometry.computeBoundingSphere();
          surface.image.data = r.surface;
          surface.needsUpdate = true;
          light.image.data = r.light;
          light.needsUpdate = true;
          su.uSeaY.value = seaRel * kk;
          return { lightMs: r.ms.light };
        },
        dispose: () => {
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
    const lodStyl = (vr: MaterialVariant) => STEPS.map((_, i) => stylizedMaterial(su, { grid, skirt: skirts[i], far: i >= 2, seaByPlane: true, variant: vr }));
    const baseMats = STEPS.map((_, i) => baseMaterial(tex, { grid, skirt: skirts[i] }));
    const stylMats = { a: lodStyl("a"), b: lodStyl("b"), c: lodStyl("c"), n: lodStyl("n") };
    const lodPick = (s: Style) => (s === "base" ? baseMats : stylMats[variant]);
    const chunked = new ChunkedTerrain(b.meshHeights, b.meshLand, b.mesh.width, b.mesh.height, meshCell, lodPick(style), k);
    chunked.skipSea = style === "estilizado";
    const seaMat = seaPlaneMaterial(su, grid);
    return {
      object: chunked.group, geo, level, heightsM: b.heightsM, widthM: halfW * 2, depthM: halfD * 2, seaLevelM: b.seaLevelM,
      meshSize: b.mesh, seaMaterial: seaMat, ms: { fetch: fetchMs, ...b.ms },
      gpuBytes: () => ({
        geometry: chunked.geometryBytes(),
        textures: Math.round((b.surface.byteLength + b.light.byteLength) * (4 / 3)) + b.meshHeights.byteLength,
      }),
      lodStats: () => chunked.stats,
      beforeRender: (camera, h) => chunked.update(camera, h),
      setDetail: (on) => (su.uDetailOn.value = on ? 1 : 0),
      setLodTarget: (px) => (chunked.targetPx = px),
      styleUniforms: su,
      setVariant: (v) => {
        variant = v;
        chunked.setMaterials(lodPick(style_));
      },
      setStyle: (s) => {
        style_ = s;
        chunked.setMaterials(lodPick(s));
        // En Base el terreno dibuja su mar (sin plano); en la interpretación el agua es del plano.
        chunked.skipSea = s === "estilizado";
      },
      update: async (kk) => {
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
        chunked.dispose();
        [...baseMats, ...stylMats.a, ...stylMats.b, ...stylMats.c, ...stylMats.n, seaMat].forEach((m) => m.dispose());
        surface.dispose();
        light.dispose();
        heightTex.dispose();
      },
    };
  }
}

async function get(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falta ${url}`);
  return r.arrayBuffer();
}
