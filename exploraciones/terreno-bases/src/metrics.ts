import type * as THREE from "three";

interface LoadInfo {
  level: string;
  bytes: number;
  transferBytes: number | null;
  fetchMs: number;
  buildMs: number;
  /** desde que arranca la carga hasta ver el primer terreno */
  firstViewMs: number;
  /** hasta tener el nivel detallado (null si no hay) */
  fullMs: number | null;
}

/** Mediciones reproducibles para el registro de rendimiento (CLAUDE.md §9). */
export class Metrics {
  private frames = 0;
  private frameTimeSum = 0;
  private worstFrame = 0;
  private windowStart = performance.now();
  private last = performance.now();

  fps = 0;
  avgFrameMs = 0;
  worstFrameMs = 0;
  firstFrameMs: number | null = null;
  framesRendered = 0;
  isIdle = false;
  /** Bloqueo más largo del hilo principal (Long Tasks API; solo Chromium). */
  longestTaskMs: number | null = null;
  load: LoadInfo | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.longestTaskMs = Math.max(this.longestTaskMs ?? 0, e.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* navegador sin Long Tasks API */
    }
  }

  /** El bucle se reanuda: no contar el tiempo en reposo como un cuadro lento. */
  wake() {
    this.isIdle = false;
    this.last = performance.now();
    this.windowStart = this.last;
    this.frames = 0;
    this.frameTimeSum = 0;
    this.worstFrame = 0;
  }

  idle() {
    this.isIdle = true;
  }

  tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (this.firstFrameMs === null) this.firstFrameMs = now;
    this.framesRendered++;
    this.frames++;
    this.frameTimeSum += dt;
    this.worstFrame = Math.max(this.worstFrame, dt);
    if (now - this.windowStart >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.windowStart);
      this.avgFrameMs = this.frameTimeSum / this.frames;
      this.worstFrameMs = this.worstFrame;
      this.frames = 0;
      this.frameTimeSum = 0;
      this.worstFrame = 0;
      this.windowStart = now;
      return true; // hubo actualización
    }
    return false;
  }

  snapshot() {
    const info = this.renderer.info;
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      fecha: new Date().toISOString(),
      estado: this.isIdle ? "reposo (no dibuja)" : "dibujando",
      fps: round(this.fps),
      frameMsPromedio: round(this.avgFrameMs),
      frameMsPeor: round(this.worstFrameMs),
      cuadrosDibujados: this.framesRendered,
      drawCalls: info.render.calls,
      triangulos: info.render.triangles,
      geometrias: info.memory.geometries,
      texturas: info.memory.textures,
      primerCuadroMs: this.firstFrameMs === null ? null : round(this.firstFrameMs),
      bloqueoMaximoHiloPrincipalMs: this.longestTaskMs === null ? null : round(this.longestTaskMs),
      carga: this.load,
      pantalla: `${innerWidth}×${innerHeight} @${this.renderer.getPixelRatio()}x`,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "no disponible",
      navegador: navigator.userAgent,
    };
  }

  format() {
    const s = this.snapshot();
    const kb = (b: number | null | undefined) => (b == null ? "—" : `${(b / 1024).toFixed(0)} KB`);
    const ms = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(0)} ms`);
    return [
      this.isIdle ? `estado     reposo · 0 FPS` : `FPS        ${s.fps.toFixed(0).padStart(5)}`,
      s.fps > 0
        ? `frame      ${s.frameMsPromedio.toFixed(1).padStart(5)} ms (peor ${s.frameMsPeor.toFixed(1)})`
        : `frame          — (mové la cámara para medir)`,
      `triángulos ${s.triangulos.toLocaleString("es-AR").padStart(9)}`,
      `nivel      ${s.carga?.level ?? "—"}`,
      `descarga   ${kb(s.carga?.bytes)} · ${ms(s.carga?.fetchMs)}`,
      `worker     ${ms(s.carga?.buildMs)}`,
      `1ª vista   ${ms(s.carga?.firstViewMs)} · completo ${ms(s.carga?.fullMs)}`,
      `bloqueo    ${ms(s.bloqueoMaximoHiloPrincipalMs)} máx. hilo principal`,
    ].join("\n");
  }
}

const round = (n: number) => Math.round(n * 10) / 10;
