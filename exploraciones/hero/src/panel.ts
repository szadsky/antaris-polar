import { createDialKit, createDialRoot } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';
import { DEPTH_DEFAULTS, type LayerDepth } from './backdrop';

/**
 * Panel de ajustes de la profundidad de las montañas (DialKit, la misma librería de paneles del visor). Se muestra en
 * desarrollo o con `?panel`; nunca con `?limpio` / `?referencia` (capturas). Guarda los valores en el navegador
 * (localStorage `dialkit:hero-montanas`); «Restablecer» vuelve a los valores del código. El botón «Copiar» de DialKit
 * copia los valores para pasarlos a DEPTH_DEFAULTS (backdrop.ts) y MOVIMIENTO (main.ts).
 */
export interface MotionSettings {
  /** Desplazamiento máximo por profundidad (px de la referencia). */
  horizontal: number; vertical: number;
  /** Movimiento de la cámara (m). */
  camaraX: number; camaraY: number;
  /** Recorre el rango solo, sin mover el mouse (para ajustar). */
  animar: boolean;
}

/** Deslizador de DialKit: [valor, mínimo, máximo, paso]. */
const sl = (v: number, min: number, max: number, step: number): [number, number, number, number] => [v, min, max, step];
const layerConfig = (d: LayerDepth) => ({
  Intensidad: sl(d.intensidad, 0, 3, 0.05),
  Inicio: sl(d.inicio, -1, 1, 0.01),
  Fin: sl(d.fin, -1, 2, 0.01),
  Offset: sl(d.offset, -1, 1, 0.01),
  Curva: sl(d.curva, 0.25, 3, 0.05),
  Contraste: sl(d.contraste, 0, 3, 0.05),
  Relieve: sl(d.relieve, 0, 2, 0.05),
  'Corrimiento X (px)': sl(d.corrimientoX, -40, 40, 1),
  'Corrimiento Y (px)': sl(d.corrimientoY, -40, 40, 1),
});
type LayerValues = Record<keyof ReturnType<typeof layerConfig>, number>;
const toLayer = (v: LayerValues): LayerDepth => ({
  intensidad: v.Intensidad, inicio: v.Inicio, fin: v.Fin, offset: v.Offset, curva: v.Curva, contraste: v.Contraste,
  relieve: v.Relieve, corrimientoX: v['Corrimiento X (px)'], corrimientoY: v['Corrimiento Y (px)'],
});

export function mountDepthPanel(o: {
  motion: MotionSettings;
  onLayer: (name: 'cumbres' | 'laderas', v: LayerDepth) => void;
  onMotion: (m: MotionSettings) => void;
}) {
  const root = createDialRoot({ position: 'top-right', theme: 'dark', versions: 'menu' });
  const config = {
    'Cumbres (montañas nevadas)': layerConfig(DEPTH_DEFAULTS.cumbres),
    'Laderas (montes bajos)': { ...layerConfig(DEPTH_DEFAULTS.laderas), _collapsed: true },
    Movimiento: {
      'Profundidad horizontal (px)': sl(o.motion.horizontal, 0, 80, 1),
      'Profundidad vertical (px)': sl(o.motion.vertical, 0, 40, 1),
      'Cámara horizontal (m)': sl(o.motion.camaraX, 0, 0.6, 0.01),
      'Cámara vertical (m)': sl(o.motion.camaraY, 0, 0.3, 0.01),
      Animar: o.motion.animar,
    },
    Restablecer: { type: 'action' as const },
  };
  const kit = createDialKit('Profundidad de las montañas', config, {
    id: 'hero-montanas',
    persist: true,
    onAction: (path: string) => { if (path === 'Restablecer') kit.resetValues(); },
  });
  kit.subscribe((v) => {
    const values = v as unknown as Record<string, Record<string, number | boolean>>;
    o.onLayer('cumbres', toLayer(values['Cumbres (montañas nevadas)'] as unknown as LayerValues));
    o.onLayer('laderas', toLayer(values['Laderas (montes bajos)'] as unknown as LayerValues));
    const m = values.Movimiento;
    o.onMotion({
      horizontal: m['Profundidad horizontal (px)'] as number, vertical: m['Profundidad vertical (px)'] as number,
      camaraX: m['Cámara horizontal (m)'] as number, camaraY: m['Cámara vertical (m)'] as number, animar: m.Animar as boolean,
    });
  });
  return { destroy() { kit.destroy(); root.destroy(); } };
}
