import * as THREE from "three";
import type { BuiltMsg, ExaggeratedMsg } from "./surface.worker";

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

export interface Terrain {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  level: Level;
  heightsM: Float32Array;
  widthM: number;
  depthM: number;
  meshSize: { width: number; height: number };
  ms: { fetch: number; decode: number; surface: number; mesh: number };
  setExaggeration(k: number): Promise<void>;
  /** 1 = Después (luz y color por píxel + cavidades + detalle), 0 = Antes (por vértice). */
  setMode(after: boolean): void;
  dispose(): void;
}

// Colores en espacio lineal.
const SNOW = new THREE.Color("#eef3f6");
const ROCK = new THREE.Color("#4a4643");
const SEA = new THREE.Color("#1d3a4c");

/** Paso de malla: una muestra de cada 2 → la malla es de 8 m (4m) o 16 m (8m), como en terreno-bases. */
export const MESH_STRIDE = 2;

export class TerrainLoader {
  private worker = new Worker(new URL("./surface.worker.ts", import.meta.url), { type: "module" });
  private waiting = new Map<string, (m: BuiltMsg | ExaggeratedMsg) => void>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<BuiltMsg | ExaggeratedMsg | { type: "error"; message: string }>) => {
      const m = e.data;
      if (m.type === "error") return console.error("Worker:", m.message);
      const k = `${m.type}:${m.key}`;
      this.waiting.get(k)?.(m);
      this.waiting.delete(k);
    };
  }

  private call<T extends BuiltMsg | ExaggeratedMsg>(
    reply: T["type"],
    payload: { type: string; key: string; [k: string]: unknown },
    transfer: Transferable[] = []
  ) {
    return new Promise<T>((resolve) => {
      this.waiting.set(`${reply}:${payload.key}`, resolve as (m: BuiltMsg | ExaggeratedMsg) => void);
      this.worker.postMessage(payload, transfer);
    });
  }

  async load(dir: string, meta: TerrainMeta, level: Level, exaggeration: number, after: boolean): Promise<Terrain> {
    const t0 = performance.now();
    const [bin, mask] = await Promise.all([get(`${dir}/${level.file}`), level.maskFile ? get(`${dir}/${level.maskFile}`) : null]);
    const fetchMs = performance.now() - t0;
    const key = `${dir}/${level.file}`;
    const b = await this.call<BuiltMsg>(
      "built",
      {
        type: "build",
        key,
        bin,
        mask,
        width: level.width,
        height: level.height,
        cellSizeM: level.cellSizeM,
        minM: meta.heights.minM,
        stepM: meta.heights.stepM,
        stride: MESH_STRIDE,
        exaggeration,
      },
      mask ? [bin, mask] : [bin]
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(b.index, 1));
    geometry.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
    geometry.setAttribute("surfUv", new THREE.BufferAttribute(b.uvs, 2));
    geometry.computeBoundingSphere();

    const surface = new THREE.DataTexture(b.surface, level.width, level.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    surface.colorSpace = THREE.NoColorSpace; // datos, no color
    surface.generateMipmaps = true;
    surface.minFilter = THREE.LinearMipmapLinearFilter;
    surface.magFilter = THREE.LinearFilter;
    surface.anisotropy = 8;
    surface.needsUpdate = true;

    const uniforms = {
      uSurface: { value: surface },
      uMode: { value: after ? 1 : 0 },
      uSnow: { value: new THREE.Vector3(SNOW.r, SNOW.g, SNOW.b) },
      uRock: { value: new THREE.Vector3(ROCK.r, ROCK.g, ROCK.b) },
      uSea: { value: new THREE.Vector3(SEA.r, SEA.g, SEA.b) },
    };
    const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 surfUv;\nvarying vec2 vSurfUv;\nvarying vec3 vObjNormal;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfUv = surfUv;\nvObjNormal = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform sampler2D uSurface;
uniform float uMode;
uniform vec3 uSnow;
uniform vec3 uRock;
uniform vec3 uSea;
varying vec2 vSurfUv;
varying vec3 vObjNormal;`
        )
        // Color por píxel: clase (mar / tierra), pendiente y cavidades.
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
vec4 surf = texture2D(uSurface, vSurfUv);
if (surf.a < 0.25) discard;               // sin dato: no se dibuja
vec3 nDet = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);
nDet.y = sqrt(max(0.0, 1.0 - dot(nDet.xz, nDet.xz)));
float ny = mix(normalize(vObjNormal).y, nDet.y, uMode);
// Nieve en lo suave, roca en lo empinado (estético: no es cobertura del suelo).
vec3 ground = mix(uSnow, uRock, smoothstep(0.18, 0.42, 1.0 - ny));
float isSea = 1.0 - smoothstep(0.55, 0.85, surf.a);
float cavity = mix(1.0, surf.b, uMode * (1.0 - isSea));
diffuseColor.rgb = mix(ground, uSea, isSea) * cavity;`
        )
        // Luz por píxel: la normal de la textura (malla sin rotación → objeto = mundo).
        .replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>
normal = normalize(mix(normal, normalize((viewMatrix * vec4(nDet, 0.0)).xyz), uMode));`
        );
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "terreno-rema";

    return {
      mesh,
      level,
      heightsM: b.heightsM,
      widthM: (level.width - 1) * level.cellSizeM,
      depthM: (level.height - 1) * level.cellSizeM,
      meshSize: b.mesh,
      ms: { fetch: fetchMs, ...b.ms },
      setExaggeration: async (k: number) => {
        const r = await this.call<ExaggeratedMsg>("exaggerated", { type: "exaggerate", key, exaggeration: k });
        geometry.setAttribute("position", new THREE.BufferAttribute(r.positions, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(r.normals, 3));
        geometry.computeBoundingSphere();
        surface.image.data = r.surface;
        surface.needsUpdate = true;
      },
      setMode(after: boolean) {
        uniforms.uMode.value = after ? 1 : 0;
      },
      dispose() {
        geometry.dispose();
        material.dispose();
        surface.dispose();
      },
    };
  }
}

async function get(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`falta ${url}`);
  return r.arrayBuffer();
}
