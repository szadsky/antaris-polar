import * as THREE from "three";
import type { MapControls } from "three/examples/jsm/controls/MapControls.js";

/**
 * Banco de medición reproducible (fase 0, .claude/rules/3d-performance.md).
 * Recorre poses de cámara fijas relativas a la base y al tamaño del recorte; en cada
 * una dibuja N cuadros de forma sincrónica y mide:
 *   - tiempo de GPU por cuadro (EXT_disjoint_timer_query_webgl2), mediana y p95;
 *   - tiempo CPU+GPU sincronizado (render + readPixels), mediana y p95;
 *   - triángulos y draw calls.
 * No depende de requestAnimationFrame (que el navegador frena en pestañas ocultas).
 */

export interface Pose {
  name: string;
  target: [number, number, number]; // fracción del tamaño, relativo a la base
  camera: [number, number, number];
}

export const POSES: Pose[] = [
  { name: "general", target: [0, 0, 0], camera: [0, 0.42, 0.72] },
  { name: "media", target: [0.12, 0.02, -0.08], camera: [0.42, 0.22, 0.34] },
  { name: "cerca", target: [0.05, 0.01, 0.06], camera: [0.14, 0.07, 0.17] },
  { name: "rasante", target: [0, 0.02, -0.15], camera: [-0.32, 0.05, 0.3] },
  { name: "cenital", target: [0, 0, 0], camera: [0, 0.95, 0.02] },
];

export interface BenchCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  origin: THREE.Vector3; // posición de la base en la escena
  size: number;
  /** Elige bloques y niveles (LOD) para la cámara actual. */
  beforeRender?: () => void;
  /** Estadísticas del LOD tras beforeRender. */
  lodStats?: () => unknown;
  /** Same complete render path as the viewer, including reflections and outline. */
  render?: () => void;
}

export function applyPose(ctx: BenchCtx, i: number) {
  const p = POSES[i % POSES.length];
  const s = ctx.size;
  const o = ctx.origin;
  ctx.controls.target.set(o.x + p.target[0] * s, p.target[1] * s, o.z + p.target[2] * s);
  ctx.camera.position.set(o.x + p.camera[0] * s, p.camera[1] * s, o.z + p.camera[2] * s);
  ctx.controls.update();
  ctx.beforeRender?.();
}

const px = new Uint8Array(4);

export async function runBench(ctx: BenchCtx, framesPerPose = 20) {
  const { renderer, scene, camera } = ctx;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const tq = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const gpu: number[] = [];
  const sync: number[] = [];
  const poses: Record<string, { gpuMs: number | null; syncMs: number; triangulos: number; drawCalls: number; lod?: unknown }> = {};

  for (let i = 0; i < POSES.length; i++) {
    applyPose(ctx, i);
    for (let w = 0; w < 3; w++) (ctx.render ?? (() => renderer.render(scene, camera)))(); // calentamiento (compila shaders)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const g: number[] = [];
    const sy: number[] = [];
    for (let f = 0; f < framesPerPose; f++) {
      const t0 = performance.now();
      let q: WebGLQuery | null = null;
      if (tq) {
        q = gl.createQuery()!;
        gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
      }
      (ctx.render ?? (() => renderer.render(scene, camera)))();
      if (tq && q) gl.endQuery(tq.TIME_ELAPSED_EXT);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sy.push(performance.now() - t0);
      if (tq && q) {
        let tries = 0;
        while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) && tries++ < 200) await new Promise((r) => setTimeout(r, 2));
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) g.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    }
    gpu.push(...g);
    sync.push(...sy);
    poses[POSES[i].name] = {
      gpuMs: g.length ? round(pct(g, 0.5)) : null,
      syncMs: round(pct(sy, 0.5)),
      triangulos: renderer.info.render.triangles,
      drawCalls: renderer.info.render.calls,
      lod: ctx.lodStats?.(),
    };
  }
  applyPose(ctx, 0);
  return {
    gpuMs: gpu.length ? { mediana: round(pct(gpu, 0.5)), p95: round(pct(gpu, 0.95)) } : null,
    cuadroSincronizadoMs: { mediana: round(pct(sync, 0.5)), p95: round(pct(sync, 0.95)) },
    poses,
  };
}

function pct(a: number[], p: number) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * FPS reales: la cámara recorre una órbita alrededor de la base durante `seconds` y se
 * dibuja en cada requestAnimationFrame. Mide el intervalo entre cuadros (incluye todo:
 * CPU, GPU y composición del navegador). Solo es válido con la pestaña visible: el
 * navegador frena rAF en pestañas ocultas (`valido` lo indica).
 */
export function runFpsTest(ctx: BenchCtx, seconds = 6): Promise<{
  fps: number;
  frametimeMs: { promedio: number; p95: number };
  cuadros: number;
  valido: boolean;
}> {
  const { renderer, scene, camera, controls, origin, size } = ctx;
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last = 0;
    const t0 = performance.now();
    let hidden = document.visibilityState !== "visible";
    const step = (now: number) => {
      if (document.visibilityState !== "visible") hidden = true;
      const t = (now - t0) / 1000;
      const a = (t / seconds) * Math.PI * 2;
      controls.target.set(origin.x, size * 0.01, origin.z);
      camera.position.set(origin.x + Math.sin(a) * size * 0.35, size * 0.16, origin.z + Math.cos(a) * size * 0.35);
      camera.lookAt(controls.target);
      ctx.beforeRender?.();
      (ctx.render ?? (() => renderer.render(scene, camera)))();
      if (last) intervals.push(now - last);
      last = now;
      if (t < seconds) requestAnimationFrame(step);
      else {
        const s = [...intervals].sort((x, y) => x - y);
        const avg = intervals.reduce((p, c) => p + c, 0) / intervals.length;
        resolve({
          fps: Math.round((1000 / avg) * 10) / 10,
          frametimeMs: { promedio: Math.round(avg * 100) / 100, p95: Math.round(s[Math.floor(s.length * 0.95)] * 100) / 100 },
          cuadros: intervals.length,
          valido: !hidden,
        });
        controls.update();
      }
    };
    requestAnimationFrame(step);
  });
}
