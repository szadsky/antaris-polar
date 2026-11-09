/**
 * Máscara tierra/mar a partir de polígonos de costa del SCAR Antarctic Digital Database (ADD).
 *
 * Entrada: respuesta Esri JSON de la capa "High resolution vector polygons of the
 * Antarctic coastline" (FeatureServer/1), consultada con outSR=3031.
 * Los polígonos describen la superficie (land / ice shelf / ice tongue / rumple):
 * todo lo que queda fuera de ellos es mar.
 */

/** Rasteriza por líneas de barrido con regla par-impar (respeta huecos). */
export function rasterizeLand(features, { width, height, originX, originY, resX, resY }) {
  const mask = new Uint8Array(width * height);
  const edges = [];
  for (const f of features) {
    for (const ring of f.geometry.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j];
        const [x1, y1] = ring[i];
        if (y0 === y1) continue;
        edges.push(y0 < y1 ? [x0, y0, x1, y1] : [x1, y1, x0, y0]);
      }
    }
  }
  // Índice por fila para no recorrer todas las aristas en cada línea.
  const rowEdges = Array.from({ length: height }, () => []);
  for (const e of edges) {
    // fila = (originY - y) / |resY| ; el centro de la fila r está en originY + (r + .5) * resY
    let rA = Math.ceil((originY - e[3]) / -resY - 0.5);
    let rB = Math.floor((originY - e[1]) / -resY - 0.5);
    rA = Math.max(rA, 0);
    rB = Math.min(rB, height - 1);
    for (let r = rA; r <= rB; r++) rowEdges[r].push(e);
  }

  const xs = [];
  for (let r = 0; r < height; r++) {
    const y = originY + (r + 0.5) * resY;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of rowEdges[r]) {
      if (y < y0 || y >= y1) continue;
      xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let c0 = Math.ceil((xs[k] - originX) / resX - 0.5);
      let c1 = Math.floor((xs[k + 1] - originX) / resX - 0.5);
      c0 = Math.max(c0, 0);
      c1 = Math.min(c1, width - 1);
      for (let c = c0; c <= c1; c++) mask[r * width + c] = 1;
    }
  }
  return mask;
}

/** Reduce la máscara por bloques: tierra si al menos la mitad del bloque es tierra. */
export function downsampleMask(mask, W, factor, w, h) {
  const out = new Uint8Array(w * h);
  const half = (factor * factor) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let land = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * W + x * factor;
        for (let dx = 0; dx < factor; dx++) land += mask[row + dx];
      }
      out[y * w + x] = land >= half ? 1 : 0;
    }
  }
  return out;
}
