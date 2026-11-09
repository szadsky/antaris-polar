import * as THREE from "three";

/**
 * Terreno por bloques con nivel de detalle (fase 2).
 *
 * - La grilla de malla (p. ej. 1000×1000 a 8 m) se divide en bloques de CHUNK celdas.
 * - Hay una plantilla de geometría por nivel (paso 1, 2, 4, 8 celdas): solo índices de
 *   celda; la altura la lee el vertex shader de una textura → memoria de geometría mínima
 *   y la exageración vertical es un uniform.
 * - Un InstancedMesh por nivel: como máximo 4 draw calls para todo el terreno.
 * - En cada cambio de cámara: descarte por pirámide de visión con la caja de alturas real
 *   de cada bloque y elección de nivel por tamaño en pantalla de una celda.
 * - Faldones (bordes que bajan) tapan las uniones entre bloques de distinto nivel.
 */

export const CHUNK = 128; // celdas por lado de bloque
export const STEPS = [1, 2, 4, 8]; // paso de cada nivel (celdas)
/** Un bloque solo se considera "todo mar" si no hay tierra a menos de este margen (celdas):
 *  el agua costera la dibuja el terreno. 12 celdas × 8 m ≈ 96 m. */
const COAST_MARGIN = 12;
/** Tamaño máximo por defecto de una celda del nivel elegido en pantalla (px): más chico = más detalle. */
const TARGET_PX = 7;

interface Chunk {
  col: number;
  row: number;
  minH: number;
  maxH: number;
  allSea: boolean;
  /** Tiene tierra y mar: la costa se ve mal con triángulos grandes → un nivel más fino. */
  coast: boolean;
  box: THREE.Box3;
  center: THREE.Vector3;
}

export interface LodStats {
  visibles: number;
  descartados: number;
  porNivel: number[];
  triangulos: number;
}

export class ChunkedTerrain {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  private chunks: Chunk[] = [];
  private offsets: THREE.InstancedBufferAttribute[] = [];
  private trisPerInstance: number[] = [];
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private tmp = new THREE.Vector3();
  stats: LodStats = { visibles: 0, descartados: 0, porNivel: [0, 0, 0, 0], triangulos: 0 };
  /** Saltear bloques que son todo mar (cuando el agua la dibuja el plano). */
  skipSea = true;
  /** Calidad adaptativa (fase 4): tamaño máximo de una celda en pantalla. */
  targetPx = TARGET_PX;

  constructor(
    heights: Float32Array,
    land: Uint8Array,
    private mw: number,
    private mh: number,
    private cell: number,
    materials: THREE.Material[],
    private k = 1
  ) {
    const halfW = ((mw - 1) * cell) / 2;
    const halfD = ((mh - 1) * cell) / 2;
    for (let row = 0; row < mh - 1; row += CHUNK) {
      for (let col = 0; col < mw - 1; col += CHUNK) {
        let minH = Infinity, maxH = -Infinity, landCount = 0, total = 0, landNear = 0;
        for (let y = row; y <= Math.min(row + CHUNK, mh - 1); y++) {
          for (let x = col; x <= Math.min(col + CHUNK, mw - 1); x++) {
            const v = heights[y * mw + x];
            if (v < minH) minH = v;
            if (v > maxH) maxH = v;
            landCount += land[y * mw + x];
            total++;
          }
        }
        for (let y = Math.max(0, row - COAST_MARGIN); y <= Math.min(row + CHUNK + COAST_MARGIN, mh - 1); y++)
          for (let x = Math.max(0, col - COAST_MARGIN); x <= Math.min(col + CHUNK + COAST_MARGIN, mw - 1); x++) landNear += land[y * mw + x];
        const x0 = col * cell - halfW, x1 = Math.min(col + CHUNK, mw - 1) * cell - halfW;
        const z0 = row * cell - halfD, z1 = Math.min(row + CHUNK, mh - 1) * cell - halfD;
        this.chunks.push({
          col, row, minH, maxH,
          allSea: landNear === 0,
          coast: landCount > 0 && landCount < total,
          box: new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1)),
          center: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2),
        });
      }
    }
    STEPS.forEach((step, li) => {
      const geo = chunkTemplate(step);
      const offs = new THREE.InstancedBufferAttribute(new Float32Array(this.chunks.length * 2), 2);
      offs.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute("chunk", offs);
      const mesh = new THREE.InstancedMesh(geo, materials[li], this.chunks.length);
      mesh.frustumCulled = false; // el descarte lo hacemos por bloque
      mesh.count = 0;
      mesh.name = `terreno-lod${li}`;
      this.meshes.push(mesh);
      this.offsets.push(offs);
      this.trisPerInstance.push(geo.index!.count / 3);
      this.group.add(mesh);
    });
    this.setExaggeration(k);
  }

  setMaterials(materials: THREE.Material[]) {
    this.meshes.forEach((m, i) => (m.material = materials[i]));
  }

  setExaggeration(k: number) {
    this.k = k;
    for (const c of this.chunks) {
      // margen para faldones y para el cierre del borde
      c.box.min.y = c.minH * k - 200;
      c.box.max.y = c.maxH * k + 5;
      c.center.y = ((c.minH + c.maxH) / 2) * k;
    }
  }

  /** Recalcula bloques visibles y nivel de cada uno. Llamar antes de dibujar si la cámara cambió. */
  update(camera: THREE.PerspectiveCamera, viewportHeightPx: number) {
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const pxPerRad = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const counts = [0, 0, 0, 0];
    let culled = 0;
    for (const c of this.chunks) {
      if ((this.skipSea && c.allSea) || !this.frustum.intersectsBox(c.box)) {
        culled++;
        continue;
      }
      const d = Math.max(1, c.box.distanceToPoint(camera.position));
      const cellPx = (this.cell / d) * pxPerRad; // tamaño en pantalla de una celda de 8 m
      let li = 0;
      while (li < STEPS.length - 1 && STEPS[li + 1] * cellPx <= this.targetPx) li++;
      const a = this.offsets[li];
      a.setXY(counts[li], c.col, c.row);
      counts[li]++;
    }
    let tris = 0;
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      this.offsets[i].needsUpdate = true;
      tris += counts[i] * this.trisPerInstance[i];
    });
    this.stats = { visibles: this.chunks.length - culled, descartados: culled, porNivel: counts, triangulos: tris };
    void this.tmp;
  }

  /** Bytes en GPU de la geometría (plantillas + desplazamientos de instancia). */
  geometryBytes() {
    let b = 0;
    for (const m of this.meshes) {
      const g = m.geometry;
      b += g.index!.array.byteLength;
      for (const a of Object.values(g.attributes)) b += (a as THREE.BufferAttribute).array.byteLength;
    }
    return b;
  }

  get chunkCount() {
    return this.chunks.length;
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
  }
}

/**
 * Plantilla de bloque: (n+1)² vértices de grilla con paso `step` + un anillo de faldón.
 * `position` = (celda x, celda z, esFaldón). Índices de 16 bits.
 */
function chunkTemplate(step: number) {
  const n = CHUNK / step;
  const verts = (n + 1) * (n + 1);
  const pos: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) pos.push(i * step, j * step, 0);
  const idx: number[] = [];
  const v = (i: number, j: number) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j + 1), d = v(i + 1, j);
      idx.push(a, b, d, b, c, d);
    }
  }
  // Faldón: copia de cada vértice del borde, bajada en el shader (position.z = 1).
  const ring: number[] = [];
  for (let i = 0; i <= n; i++) ring.push(v(i, 0));
  for (let j = 1; j <= n; j++) ring.push(v(n, j));
  for (let i = n - 1; i >= 0; i--) ring.push(v(i, n));
  for (let j = n - 1; j >= 1; j--) ring.push(v(0, j));
  const skirtStart = verts;
  ring.forEach((src) => pos.push(pos[src * 3], pos[src * 3 + 1], 1));
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r], b = ring[(r + 1) % ring.length];
    const a2 = skirtStart + r, b2 = skirtStart + ((r + 1) % ring.length);
    // doble cara: el faldón puede verse desde cualquier lado
    idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // normal constante: la iluminación usa la normal de la textura de superficie
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(new THREE.Uint16BufferAttribute(idx, 1));
  return g;
}
