import { MeshoptSimplifier } from "meshoptimizer/meshopt_simplifier.module.js";
import { TILE } from "./tile-size";

/**
 * Niveles de detalle de la malla costera (en el worker, al cargar). La malla costera horneada se dibujaba siempre
 * completa (244 k triángulos en Brown a 4 m), también a 14 km, donde sus triángulos quedan más chicos que un píxel.
 *
 * Por cada bloque costero (TILE celdas de malla) se simplifica la superficie con meshoptimizer (MIT, A. Kapoulkine)
 * con el **borde del bloque fijo** (LockBorder): los vértices del perímetro son los mismos en todos los niveles, así
 * que empalma sin grietas con los bloques vecinos (costeros de cualquier nivel o del LOD instanciado, que conserva
 * el perímetro nativo). Las caras verticales (cierre del diorama, con vértices propios de `coastalNormals`) no se
 * simplifican: quedan iguales en todos los niveles y sus bordes también quedan fijos.
 *
 * El error es absoluto en metros (sin exagerar): ninguna superficie simplificada se aparta más que eso de la malla
 * original, que sigue saliendo de REMA. El índice resultante concatena, por nivel, los grupos de bloques en orden
 * de Morton (bloques cercanos quedan contiguos y se dibujan juntos). `ranges[(nivel * grupos + grupo) * 2]` =
 * inicio y cantidad de índices.
 */
export const COAST_LOD_ERRORS_M = [0, 1, 2, 8];
/** Bloques costeros por lado en cada grupo de dibujo (2 × 2 bloques: 512 m con la malla de 8 m). */
export const COAST_LOD_GROUP = 2;

export interface CoastLod {
  index: Uint32Array<ArrayBuffer>;
  ranges: Uint32Array;
  /** Por grupo: minX, minY, minZ, maxX, maxY, maxZ (m, alturas sin exagerar). */
  boxes: Float32Array;
  errors: number[];
  groups: number;
  ms: number;
}

const morton = (x: number, y: number) => {
  let m = 0;
  for (let b = 0; b < 16; b++) m |= ((x >> b) & 1) << (2 * b) | ((y >> b) & 1) << (2 * b + 1);
  return m >>> 0;
};

export async function buildCoastLod(positions: Float32Array, index: Uint32Array, normals: Float32Array, meshW: number, meshH: number, meshCell: number): Promise<CoastLod> {
  const t0 = performance.now();
  await MeshoptSimplifier.ready;
  const halfW = ((meshW - 1) * meshCell) / 2, halfD = ((meshH - 1) * meshCell) / 2;
  const span = meshCell * TILE;
  const tw = Math.ceil((meshW - 1) / TILE), th = Math.ceil((meshH - 1) / TILE);
  const gw = Math.ceil(tw / COAST_LOD_GROUP), gh = Math.ceil(th / COAST_LOD_GROUP);
  // Grupos en orden de Morton (solo los que tienen triángulos).
  const order = Array.from({ length: gw * gh }, (_, i) => i).sort((a, b) => morton(a % gw, Math.floor(a / gw)) - morton(b % gw, Math.floor(b / gw)));
  const rank = new Int32Array(gw * gh); order.forEach((g, i) => (rank[g] = i));
  // Triángulos por bloque: superficie (se simplifica) y caras verticales (quedan iguales).
  const surf = new Map<number, number[]>(), walls = new Map<number, number[]>();
  const wall = (v: number) => normals[v * 3 + 1] === 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const x = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3, z = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
    const col = Math.min(tw - 1, Math.max(0, Math.floor((x + halfW) / span))), row = Math.min(th - 1, Math.max(0, Math.floor((z + halfD) / span)));
    const tile = row * tw + col, dst = wall(a) && wall(b) && wall(c) ? walls : surf;
    let list = dst.get(tile); if (!list) dst.set(tile, (list = [])); list.push(a, b, c);
  }
  const tiles = [...new Set([...surf.keys(), ...walls.keys()])];
  const groupOf = (tile: number) => { const col = tile % tw, row = Math.floor(tile / tw); return rank[Math.floor(row / COAST_LOD_GROUP) * gw + Math.floor(col / COAST_LOD_GROUP)]; };
  const G = gw * gh, L = COAST_LOD_ERRORS_M.length;
  // Niveles en cascada: cada uno se simplifica desde el anterior con el error que falta (más rápido; el error total
  // queda acotado por el del nivel).
  const perLevel: Map<number, Uint32Array>[] = [];
  let prev = new Map<number, Uint32Array>(tiles.map((t) => [t, Uint32Array.from(surf.get(t) ?? [])]));
  perLevel.push(prev);
  for (let l = 1; l < L; l++) {
    const step = COAST_LOD_ERRORS_M[l] - COAST_LOD_ERRORS_M[l - 1];
    const next = new Map<number, Uint32Array>();
    for (const [tile, tri] of prev) {
      if (tri.length === 0) { next.set(tile, tri); continue; }
      const [out] = MeshoptSimplifier.simplify(tri, positions, 3, 0, step, ["LockBorder", "Sparse", "ErrorAbsolute"]);
      next.set(tile, out);
    }
    perLevel.push(next);
    prev = next;
  }
  // Índice final: [nivel][grupo en orden de Morton] → superficie del nivel + caras verticales.
  const byGroup: number[][] = Array.from({ length: G }, () => []);
  for (const t of tiles) byGroup[groupOf(t)].push(t);
  let total = 0;
  for (let l = 0; l < L; l++) for (const t of tiles) total += perLevel[l].get(t)!.length + (walls.get(t)?.length ?? 0);
  const out = new Uint32Array(total), ranges = new Uint32Array(L * G * 2);
  let o = 0;
  for (let l = 0; l < L; l++) for (let g = 0; g < G; g++) {
    const start = o;
    for (const t of byGroup[g]) {
      const s = perLevel[l].get(t)!;
      // El vértice más alto de cada triángulo va último (varying `flat` vTopY del shader), como en la malla original.
      for (let k = 0; k < s.length; k += 3) {
        const a = s[k], b = s[k + 1], c = s[k + 2];
        const ya = positions[a * 3 + 1], yb = positions[b * 3 + 1], yc = positions[c * 3 + 1];
        if (ya >= yb && ya >= yc) { out[o++] = b; out[o++] = c; out[o++] = a; }
        else if (yb >= yc) { out[o++] = c; out[o++] = a; out[o++] = b; }
        else { out[o++] = a; out[o++] = b; out[o++] = c; }
      }
      const w = walls.get(t);
      if (w) for (const v of w) out[o++] = v;
    }
    ranges[(l * G + g) * 2] = start;
    ranges[(l * G + g) * 2 + 1] = o - start;
  }
  // Cajas por grupo (del nivel completo, que contiene todos los vértices de los demás).
  const boxes = new Float32Array(G * 6);
  for (let g = 0; g < G; g++) { boxes.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], g * 6); }
  for (let g = 0; g < G; g++) {
    const s = ranges[g * 2], n = ranges[g * 2 + 1];
    for (let k = s; k < s + n; k++) {
      const v = out[k] * 3;
      for (let a = 0; a < 3; a++) {
        const p = positions[v + a];
        if (p < boxes[g * 6 + a]) boxes[g * 6 + a] = p;
        if (p > boxes[g * 6 + 3 + a]) boxes[g * 6 + 3 + a] = p;
      }
    }
  }
  return { index: out, ranges, boxes, errors: COAST_LOD_ERRORS_M, groups: G, ms: performance.now() - t0 };
}
