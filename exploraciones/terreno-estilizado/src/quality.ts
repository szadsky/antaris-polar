/**
 * Calidad adaptativa (fase 4).
 *
 * Tres niveles que tocan lo que más pesa en GPU sin cambiar el dato:
 *   - resolución de dibujo (DPR),
 *   - densidad del LOD (tamaño máximo en pantalla de una celda),
 *   - detalle de cerca (fase 3A).
 * El nivel de alturas (4 m / 8 m) se elige al cargar: cambiarlo en caliente implicaría
 * volver a descargar y procesar el terreno.
 *
 * Elección inicial por dispositivo (heurística, no medición) y luego ajuste automático por
 * tiempo de GPU medido con EXT_disjoint_timer_query_webgl2 mientras la cámara se mueve.
 * Sin esa extensión (frecuente en celulares y Safari) se usa el intervalo entre cuadros, que
 * solo permite bajar de nivel: rAF está topeado por la frecuencia de la pantalla.
 */

export type Tier = "alta" | "media" | "baja";
export const TIER_ORDER: Tier[] = ["baja", "media", "alta"];

export interface TierSettings {
  /** DPR máximo (se toma el mínimo con el del dispositivo). */
  dpr: number;
  /** Tamaño máximo de una celda del LOD en pantalla (px): más alto = menos triángulos. */
  lodPx: number;
  detail: boolean;
}

export const TIERS: Record<Tier, TierSettings> = {
  alta: { dpr: 2, lodPx: 7, detail: true },
  media: { dpr: 1.5, lodPx: 11, detail: true },
  baja: { dpr: 1, lodPx: 18, detail: false },
};

/** Small supersampling on 1x desktop screens; low quality keeps its original cost. */
export function renderPixelRatio(nativeDpr: number, tier: Tier, mobile: boolean): number {
  const floor = !mobile && tier === "alta" ? 1.25 : 1;
  return Math.min(Math.max(nativeDpr, floor), TIERS[tier].dpr);
}

export interface DeviceGuess {
  mobile: boolean;
  lowEnd: boolean;
  tier: Tier;
  /** Nivel de alturas a cargar. */
  level: "4m" | "8m";
  /** Presupuesto de GPU por cuadro (ms) antes de bajar de nivel. */
  budgetMs: number;
  reason: string;
}

export function guessDevice(): DeviceGuess {
  // Celular = sin ningún puntero fino (mouse/trackpad) o pantalla chica. Una laptop táctil con
  // trackpad cuenta como escritorio (antes "pointer: coarse" la confundía con un celular).
  // Se usa la pantalla física (no la ventana, que puede estar chica al cargar).
  const mobile = !matchMedia("(any-pointer: fine)").matches || Math.min(screen.width, screen.height) < 500 || matchMedia("(max-width: 600px)").matches;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 8;
  const mem = nav.deviceMemory ?? 8;
  const lowEnd = cores <= 4 || mem <= 4;
  const tier: Tier = mobile ? (lowEnd ? "baja" : "media") : lowEnd ? "media" : "alta";
  return {
    mobile,
    lowEnd,
    tier,
    level: mobile || tier === "baja" ? "8m" : "4m",
    // Escritorio apunta a 60 FPS con margen; celular, a 30 FPS estables (reglas del proyecto).
    budgetMs: mobile ? 26 : 12,
    reason: `${mobile ? "celular o pantalla chica" : "escritorio"}, ${cores} núcleos${nav.deviceMemory ? `, ${mem} GB` : ""}${lowEnd ? " (gama baja)" : ""}`,
  };
}

/** Mide el costo de cada cuadro dibujado y decide si cambiar de nivel. */
export class AdaptiveQuality {
  private tq: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private pending: WebGLQuery[] = [];
  private samples: number[] = [];
  private lastFrame = 0;
  private cooldownUntil = 0;
  private calmWindows = 0;
  auto = true;
  lastMedianMs: number | null = null;
  source: "gpu" | "intervalo";

  constructor(
    private gl: WebGL2RenderingContext,
    public tier: Tier,
    private budgetMs: number,
    private apply: (t: Tier, why: string) => void
  ) {
    this.tq = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.source = this.tq ? "gpu" : "intervalo";
  }

  /** Llamar justo antes de renderer.render() en el bucle de dibujo. */
  begin() {
    if (!this.tq || this.pending.length > 3) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.tq.TIME_ELAPSED_EXT, q);
    this.pending.push(q);
  }

  /** Llamar justo después de renderer.render(). `moving`: la cámara se está moviendo. */
  end(moving: boolean) {
    const now = performance.now();
    if (this.tq && this.pending.length && this.gl.getQuery(this.tq.TIME_ELAPSED_EXT, this.gl.CURRENT_QUERY)) {
      this.gl.endQuery(this.tq.TIME_ELAPSED_EXT);
    }
    // Resultados de cuadros anteriores (las consultas son asíncronas).
    if (this.tq) {
      while (this.pending.length && this.gl.getQueryParameter(this.pending[0], this.gl.QUERY_RESULT_AVAILABLE)) {
        const q = this.pending.shift()!;
        const disjoint = this.gl.getParameter(this.tq.GPU_DISJOINT_EXT);
        if (!disjoint && moving) this.samples.push(this.gl.getQueryParameter(q, this.gl.QUERY_RESULT) / 1e6);
        this.gl.deleteQuery(q);
      }
    } else if (moving && this.lastFrame) {
      this.samples.push(now - this.lastFrame);
    }
    this.lastFrame = moving ? now : 0;
    if (this.samples.length >= 40) this.evaluate(now);
  }

  private evaluate(now: number) {
    const s = [...this.samples].sort((a, b) => a - b);
    const median = s[s.length >> 1];
    this.samples = [];
    this.lastMedianMs = Math.round(median * 10) / 10;
    if (!this.auto || now < this.cooldownUntil) return;
    const i = TIER_ORDER.indexOf(this.tier);
    // Sin temporizador de GPU solo se mide el intervalo entre cuadros (topeado por la pantalla).
    // A mobile 30 FPS target is not a failure of the desktop 45 FPS threshold.
    const over = this.source === "gpu" ? median > this.budgetMs : median > Math.max(1000 / 45, this.budgetMs * 1.5);
    if (over && i > 0) {
      this.calmWindows = 0;
      this.set(TIER_ORDER[i - 1], `GPU ${this.lastMedianMs} ms > ${this.budgetMs} ms`);
    } else if (this.source === "gpu" && median < this.budgetMs * 0.35 && i < TIER_ORDER.length - 1) {
      // Subir solo tras 3 ventanas holgadas seguidas (histéresis).
      if (++this.calmWindows >= 3) {
        this.calmWindows = 0;
        this.set(TIER_ORDER[i + 1], `GPU ${this.lastMedianMs} ms, holgado`);
      }
    } else this.calmWindows = 0;
  }

  set(t: Tier, why: string) {
    if (t === this.tier) return;
    this.tier = t;
    this.cooldownUntil = performance.now() + 3000;
    this.apply(t, why);
  }
}
