import * as THREE from "three";
import type { Built, BuildRequest, Exaggerated } from "./terrain.worker";

/** Formato que genera scripts/convert-rema.mjs */
export interface TerrainLevel {
  file: string;
  /** "delta-planar-v1" (ver scripts/convert-rema.mjs) o ausente = uint16 crudo */
  encoding?: string;
  /** "gzip" si el archivo viene precomprimido */
  compression?: string;
  /** uint8 por vértice: 1 = tierra/hielo según la costa SCAR ADD, 0 = mar */
  maskFile: string | null;
  width: number;
  height: number;
  cellSizeM: number;
  bytes: number;
  transferBytes?: number;
}

export interface TerrainMeta {
  id?: string;
  base?: { id: string; nombre: string; lat: number; lon: number; projected: [number, number] };
  geoid?: { egm2008: number; egm96: number } | null;
  sourceFile: string;
  crs: string | null;
  original: {
    width: number;
    height: number;
    resolutionM: [number, number];
    originProjected: [number, number];
    nodataPercent: number;
  };
  heights: {
    minM: number;
    maxM: number;
    verticalReference: string;
    seaLevelM: number | null;
  };
  levels: TerrainLevel[];
  coastline: { label: string; citation: string; licence: string } | null;
  provenance: Record<string, unknown> | null;
}

export interface Terrain {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  level: TerrainLevel;
  /** Alturas en metros relativas a minM (NaN = sin dato) */
  heightsM: Float32Array;
  widthM: number;
  depthM: number;
  ms: { fetch: number; decode: number; mesh: number; transferBytes: number };
  setExaggeration(factor: number): Promise<void>;
  dispose(): void;
}

/**
 * Carga niveles de terreno usando un Web Worker: descarga en el hilo principal
 * (para medir la red), decodificación y malla en el worker.
 */
export class TerrainLoader {
  private worker = new Worker(new URL("./terrain.worker.ts", import.meta.url), { type: "module" });
  private pending = new Map<string, (msg: Built | Exaggerated) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<Built | Exaggerated | { type: "error"; message: string }>) => {
      const msg = e.data;
      if (msg.type === "error") {
        console.error("Worker del terreno:", msg.message);
        return;
      }
      const key = `${msg.type}:${msg.key}`;
      this.pending.get(key)?.(msg);
      this.pending.delete(key);
    };
  }

  private request<T extends Built | Exaggerated>(type: "build" | "exaggerate", key: string, payload: object, transfer: Transferable[] = []) {
    return new Promise<T>((resolve) => {
      this.pending.set(`${type === "build" ? "built" : "exaggerated"}:${key}`, resolve as (m: Built | Exaggerated) => void);
      this.worker.postMessage({ type, key, ...payload }, transfer);
    });
  }

  async load(dir: string, meta: TerrainMeta, level: TerrainLevel, exaggeration: number): Promise<Terrain> {
    const t0 = performance.now();
    const [bin, mask] = await Promise.all([
      fetchBuffer(`${dir}/${level.file}`),
      level.maskFile ? fetchBuffer(`${dir}/${level.maskFile}`) : Promise.resolve(null),
    ]);
    const fetchMs = performance.now() - t0;
    const key = `${dir}/${level.file}`;
    const req: Omit<BuildRequest, "type" | "key"> = {
      bin,
      mask,
      encoding: level.encoding,
      width: level.width,
      height: level.height,
      cellSizeM: level.cellSizeM,
      minM: meta.heights.minM,
      maxM: meta.heights.maxM,
      exaggeration,
    };
    const built = await this.request<Built>("build", key, req, mask ? [bin, mask] : [bin]);
    return this.assemble(key, level, built, {
      fetch: fetchMs,
      transferBytes: transferSize(`${dir}/${level.file}`) + (level.maskFile ? transferSize(`${dir}/${level.maskFile}`) : 0),
    });
  }

  private assemble(key: string, level: TerrainLevel, b: Built, net: { fetch: number; transferBytes: number }): Terrain {
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(b.index, 1));
    geometry.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(b.colors, 3));
    geometry.setAttribute("valid", new THREE.BufferAttribute(b.valid, 1));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    // Los vértices sin dato no se dibujan: nunca se rellenan con alturas inventadas.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float valid;\nvarying float vValid;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvValid = valid;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vValid;")
        .replace("#include <clipping_planes_fragment>", "if (vValid < 0.999) discard;\n#include <clipping_planes_fragment>");
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "terreno-rema";

    const setExaggeration = async (k: number) => {
      const r = await this.request<Exaggerated>("exaggerate", key, { exaggeration: k });
      geometry.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(r.colors, 3));
      geometry.computeBoundingSphere();
    };

    return {
      mesh,
      level,
      heightsM: b.heightsM,
      widthM: (level.width - 1) * level.cellSizeM,
      depthM: (level.height - 1) * level.cellSizeM,
      ms: { fetch: net.fetch, decode: b.ms.decode, mesh: b.ms.mesh, transferBytes: net.transferBytes },
      setExaggeration,
      dispose() {
        geometry.dispose();
        material.dispose();
      },
    };
  }
}

async function fetchBuffer(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`falta ${url}`);
  return res.arrayBuffer();
}

function transferSize(url: string) {
  const e = performance.getEntriesByName(new URL(url, location.href).href).at(-1) as PerformanceResourceTiming | undefined;
  return e?.transferSize || e?.encodedBodySize || 0;
}
