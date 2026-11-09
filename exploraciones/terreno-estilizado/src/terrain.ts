import * as THREE from "three";
import type { BuiltMsg, UpdatedMsg, Vec3 } from "./worker";
import { baseMaterial, stylizedMaterial } from "./materials";

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

export interface Terrain {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  level: Level;
  heightsM: Float32Array;
  widthM: number;
  depthM: number;
  seaLevelM: number | null;
  meshSize: { width: number; height: number };
  ms: { fetch: number; decode: number; surface: number; light: number; mesh: number };
  gpuBytes: { geometry: number; textures: number };
  setStyle(s: Style): void;
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

  async load(dir: string, meta: TerrainMeta, level: Level, exaggeration: number, style: Style, maxAniso: number): Promise<Terrain> {
    const t0 = performance.now();
    const [bin, mask] = await Promise.all([get(`${dir}/${level.file}`), level.maskFile ? get(`${dir}/${level.maskFile}`) : null]);
    const fetchMs = performance.now() - t0;
    const key = `${dir}/${level.file}`;
    const b = await this.call<BuiltMsg>(
      "built",
      { type: "build", key, bin, mask, width: level.width, height: level.height, cellSizeM: level.cellSizeM, stepM: meta.heights.stepM, stride: MESH_STRIDE, exaggeration, sun: this.sun },
      mask ? [bin, mask] : [bin]
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(b.index, 1));
    geometry.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
    geometry.setAttribute("surfUv", new THREE.BufferAttribute(b.uvs, 2));
    geometry.computeBoundingSphere();

    const dataTex = (data: Uint8Array, w: number, h: number) => {
      const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = maxAniso; // antes: 8 fijo
      t.needsUpdate = true;
      return t;
    };
    const surface = dataTex(b.surface, level.width, level.height);
    const light = dataTex(b.light, b.mesh.width, b.mesh.height);
    const tex = { surface, light };

    const widthM = (level.width - 1) * level.cellSizeM;
    const depthM = (level.height - 1) * level.cellSizeM;
    const seaRel = b.seaLevelM ?? 0;
    const matBase = baseMaterial(tex);
    const sty = stylizedMaterial(tex, { halfSize: [widthM / 2, depthM / 2], seaY: seaRel * exaggeration });
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, style === "base" ? matBase : sty.material);
    mesh.name = "terreno-rema";

    const geomBytes = b.index.byteLength + b.positions.byteLength + b.normals.byteLength + b.uvs.byteLength;
    const texBytes = Math.round((b.surface.byteLength + b.light.byteLength) * (4 / 3)); // + mipmaps

    return {
      mesh,
      level,
      heightsM: b.heightsM,
      widthM,
      depthM,
      seaLevelM: b.seaLevelM,
      meshSize: b.mesh,
      ms: { fetch: fetchMs, ...b.ms },
      gpuBytes: { geometry: geomBytes, textures: texBytes },
      setStyle(s: Style) {
        mesh.material = s === "base" ? matBase : sty.material;
      },
      update: async (k: number) => {
        const r = await this.call<UpdatedMsg>("updated", { type: "update", key, exaggeration: k, sun: this.sun });
        geometry.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
        geometry.computeBoundingSphere();
        surface.image.data = r.surface;
        surface.needsUpdate = true;
        light.image.data = r.light;
        light.needsUpdate = true;
        sty.uniforms.uSeaY.value = seaRel * k;
        return { lightMs: r.ms.light };
      },
      dispose() {
        geometry.dispose();
        matBase.dispose();
        sty.material.dispose();
        surface.dispose();
        light.dispose();
      },
    };
  }
}

async function get(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falta ${url}`);
  return r.arrayBuffer();
}
