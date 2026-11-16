// Cámara del hero, única fuente para la página y los scripts de Node (scripts/camara.mjs la reexporta).
// Reproduce el encuadre de la referencia (1672 × 941 px). Sin dependencias: se puede importar desde Node.

export const IMG = { w: 1672, h: 941 };
/** Campo vertical (supuesto artístico: lente de ~50° horizontales). La imagen no trae datos de cámara. */
export const VFOV_DEG = 30;
/** Distancia focal en píxeles de la referencia. */
export const F_PX = IMG.h / 2 / Math.tan(((VFOV_DEG / 2) * Math.PI) / 180);
/** Horizonte (agua a distancia infinita): 1,4 px sobre la costa lejana medida en la capa 04 (fila 501). */
export const HORIZON_ROW = 499.6;
/** Inclinación de la cámara (rad, > 0 mira hacia arriba): pone el horizonte en HORIZON_ROW. */
export const PITCH = Math.atan((HORIZON_ROW - IMG.h / 2) / F_PX);
/**
 * Altura de la cámara sobre el agua (m). Supuesto: 1,5 m sobre los pies del pingüino (0,95 m, 162 px en la
 * referencia) parado en una loma de 2,5 m. Con esta altura los barcos quedan a 60–800 m y miden 6–23 m.
 */
export const CAM_H = 4.0;
/** Distancias (m) de los planos pintados: reconstrucción artística (el canal Beagle tiene ~5 km de ancho). */
export const PLANES = { laderas: 5000, cumbres: 9000, cielo: 20000 };

/** Rayo (cámara en el origen, mirando a −z, +y arriba) del píxel (x, y) de la referencia. */
export function ray(x: number, y: number): [number, number, number] {
  const dx = (x - IMG.w / 2) / F_PX, dy = -(y - IMG.h / 2) / F_PX, dz = -1;
  const c = Math.cos(PITCH), s = Math.sin(PITCH);
  return [dx, dy * c - dz * s, dy * s + dz * c];
}

/** Píxel (x, y) de la referencia donde se ve el punto p (relativo a la cámara). Inversa de `ray`. */
export function project(p: [number, number, number]): [number, number] {
  const c = Math.cos(PITCH), s = Math.sin(PITCH);
  const ly = c * p[1] + s * p[2], lz = -s * p[1] + c * p[2];
  return [IMG.w / 2 + (F_PX * p[0]) / -lz, IMG.h / 2 - (F_PX * ly) / -lz];
}

/** Punto (relativo a la cámara) donde el rayo del píxel corta el plano vertical z = −dist. */
export function onPlane(x: number, y: number, dist: number): [number, number, number] {
  const r = ray(x, y), t = dist / -r[2];
  return [r[0] * t, r[1] * t, -dist];
}

/** Punto del agua (y = −CAM_H relativo a la cámara) que se ve en el píxel (x, y). */
export function onWater(x: number, y: number): [number, number, number] {
  const r = ray(x, y), t = CAM_H / -r[1];
  return [r[0] * t, -CAM_H, r[2] * t];
}
