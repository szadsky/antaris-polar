import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import rockColorUrl from "./assets/roca-color.ktx2?url";
import rockNormalUrl from "./assets/roca-normal.ktx2?url";
import snowNormalUrl from "./assets/nieve-normal.ktx2?url";
import texInfo from "./assets/texturas.json";

/**
 * Textura KTX2 del material del terreno (Basis ETC1S, 512 px con mipmaps; ver scripts/texturas.mjs).
 *   uRockCol / uRockNor  roca: Poly Haven "Marble Cliff 04" (CC0), color (sRGB) y normal (OpenGL)
 *   uSnowNor             nieve: ambientCG "Snow007A" (CC0), normal (OpenGL)
 *   uSnowNor  nieve: normal (OpenGL)  · ambientCG "Snow007A", 2 m (supuesto)
 * Uniforms compartidos por todos los bloques del terreno. Hasta que llegan, valores neutros de
 * 1×1 (gris medio, normal plana): la primera vista no espera a las texturas.
 * El transcodificador es el de Three.js (examples/jsm/libs/basis); no se agrega ninguna librería.
 */
const neutral = (r: number, g: number, b: number, srgb: boolean) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
};

export const terrainTextureUniforms = {
  uRockCol: { value: neutral(70, 70, 72, true) as THREE.Texture },
  uRockNor: { value: neutral(128, 128, 255, false) as THREE.Texture },
  uSnowNor: { value: neutral(128, 128, 255, false) as THREE.Texture },
  // Color medio lineal de la textura de roca (para el contraste), medido en el build.
  uRockMean: { value: (() => { const m = (texInfo as { archivo: string; colorMedioLineal?: number[] }[]).find((t) => t.archivo === "roca-color.ktx2")?.colorMedioLineal ?? [0.1, 0.1, 0.1]; return new THREE.Vector3(m[0], m[1], m[2]); })() },
};

// En desarrollo, Vite sirve node_modules; en el build, vite.config.ts copia los dos archivos a basis/.
const TRANSCODER = import.meta.env.DEV ? "/node_modules/three/examples/jsm/libs/basis/" : "./basis/";

let loading: Promise<{ ms: number; bytes: number }> | null = null;

export function loadTerrainTextures(renderer: THREE.WebGLRenderer, maxAniso: number) {
  loading ??= (async () => {
    const t0 = performance.now();
    const loader = new KTX2Loader().setTranscoderPath(TRANSCODER).detectSupport(renderer);
    let bytes = 0;
    const load = async (url: string, srgb: boolean) => {
      const tex = await loader.loadAsync(url);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      // anisotropía moderada: 16 vs 8 vs 4 sin diferencia visible desde las cámaras de prueba
      tex.anisotropy = Math.min(8, maxAniso);
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.needsUpdate = true;
      const r = performance.getEntriesByName(new URL(url, location.href).href).pop() as PerformanceResourceTiming | undefined;
      bytes += r?.encodedBodySize || r?.transferSize || 0;
      return tex;
    };
    const [rc, rn, sn] = await Promise.all([load(rockColorUrl, true), load(rockNormalUrl, false), load(snowNormalUrl, false)]);
    terrainTextureUniforms.uRockCol.value = rc;
    terrainTextureUniforms.uRockNor.value = rn;
    terrainTextureUniforms.uSnowNor.value = sn;
    loader.dispose();
    return { ms: performance.now() - t0, bytes };
  })();
  return loading;
}
