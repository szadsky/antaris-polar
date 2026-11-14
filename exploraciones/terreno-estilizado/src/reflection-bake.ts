import * as THREE from "three";
import type { Terrain } from "./terrain";

/**
 * Reflejo precalculado (solo desarrollo): captura una vez un cubemap del terreno y el cielo desde un punto
 * apenas sobre el agua y lo guarda como seis JPEG (`reflejo-px.jpg` … `reflejo-nz.jpg`) en la carpeta de la base,
 * a través de una ruta del servidor de Vite que solo existe en desarrollo (vite.config.ts, `/__bake-reflection`).
 * En el recorrido no se usa CubeCamera: el agua lee estos archivos (ocean.ts, modo "cubo").
 */
export const FACES = ["px", "nx", "py", "ny", "pz", "nz"] as const;

export async function bakeReflection(o: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  terrain: Terrain;
  baseId: string;
  point: THREE.Vector3;
  /** Lo que no entra en el reflejo: agua, icebergs, edificios, marcador, corte del diorama. */
  hide: THREE.Object3D[];
  size?: number;
  quality?: number;
}) {
  const { renderer, scene, terrain, baseId, point, hide } = o;
  const size = o.size ?? 256;
  const float = renderer.extensions.has("EXT_color_buffer_float");
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: float ? THREE.FloatType : THREE.UnsignedByteType, generateMipmaps: false });
  const cam = new THREE.CubeCamera(1, terrain.widthM * 8, rt);
  cam.position.copy(point);
  // LOD: todos los bloques, al nivel que corresponde a la distancia al punto (una cámara ortogonal que abarca el
  // recorte entero; el LOD por defecto solo ve lo que entra en la cámara principal).
  const half = terrain.widthM;
  const all = new THREE.OrthographicCamera(-half, half, half, -half, -1e5, 1e5);
  all.position.copy(point);
  all.lookAt(point.x, point.y - 1, point.z);
  all.updateMatrixWorld();
  terrain.beforeRender(all as unknown as THREE.PerspectiveCamera, size);
  const was = hide.map((h) => h.visible);
  hide.forEach((h) => (h.visible = false));
  try {
    cam.update(renderer, scene); // prepara las seis cámaras (sistema de coordenadas, matrices)
    // Cada cara de nuevo con el LOD que le corresponde desde el punto: con el de la cámara ortogonal de arriba
    // (todo el recorte en `size` px) el terreno salía en su nivel más grueso (~60 m) y las rocas cercanas quedaban
    // como manchas anchas que no coincidían con el relieve fino del paralaje (reflejo corrido y repetido).
    const prev = renderer.getRenderTarget();
    cam.children.forEach((c, i) => {
      terrain.beforeRender(c as THREE.PerspectiveCamera, size);
      renderer.setRenderTarget(rt, i);
      renderer.render(scene, c as THREE.PerspectiveCamera);
    });
    renderer.setRenderTarget(prev);
  } finally {
    hide.forEach((h, i) => (h.visible = was[i]));
  }
  const files: { face: string; bytes: number }[] = [];
  const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  for (let f = 0; f < 6; f++) {
    const n = size * size * 4;
    const buf = float ? new Float32Array(n) : new Uint8Array(n);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, f);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const src = (y * size + x) * 4, dst = src; // las caras del cubo ya salen en el orden de las imágenes
        for (let c = 0; c < 3; c++) {
          const v = float ? (buf as Float32Array)[src + c] : (buf as Uint8Array)[src + c] / 255;
          img.data[dst + c] = Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255); // lineal → sRGB
        }
        img.data[dst + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", o.quality ?? 0.88));
    const res = await fetch(`/__bake-reflection?base=${encodeURIComponent(baseId)}&face=${FACES[f]}`, { method: "POST", body: blob });
    if (!res.ok) throw Error("No se pudo guardar " + FACES[f] + ": " + (await res.text()));
    files.push({ face: FACES[f], bytes: blob.size });
  }
  rt.dispose();
  return { size, point: point.toArray(), files, totalBytes: files.reduce((s, f) => s + f.bytes, 0) };
}

/** Carga el cubemap guardado (sRGB → lineal). */
export function loadReflection(dir: string): Promise<THREE.CubeTexture> {
  return new Promise((resolve, reject) => {
    new THREE.CubeTextureLoader().setPath(dir + "/").load(
      FACES.map((f) => `reflejo-${f}.jpg`),
      (t) => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; resolve(t); },
      undefined,
      reject,
    );
  });
}
