import * as THREE from "three";
import type { CoastLod } from "./coast-lod-build";

/**
 * Elección por cuadro de los niveles de detalle de la malla costera (los arma coast-lod-build.ts en el worker).
 *
 * Cada grupo de bloques usa el nivel más simple cuyo error (m) se ve en pantalla como menos de `maxErrorPx`
 * píxeles desde la cámara; de cerca, la malla completa (igual que antes). Los grupos fuera de la pirámide de visión
 * no se dibujan. Los grupos contiguos en el índice con el mismo nivel se dibujan juntos: un tramo por llamada.
 *
 * La malla costera ("terreno-rema") sigue siendo un Mesh con un solo material (el corte del diorama y el resto del
 * visor la usan así): dibuja el primer tramo, y los demás los dibujan mallas hermanas que comparten sus buffers
 * (posiciones, normales, uv e índice: la GPU no duplica nada) y su material.
 */
export class CoastLodView {
  /** Error máximo en pantalla (px). 1 px: la simplificación no se distingue de la malla completa. */
  maxErrorPx = 1;
  readonly stats = { porNivel: [] as number[], triangulos: 0, tramos: 0, descartados: 0 };
  private extra: THREE.Mesh[] = [];
  private boxes: THREE.Box3[] = [];
  private frustum = new THREE.Frustum();
  private m = new THREE.Matrix4();
  private level: Int8Array;

  constructor(private mesh: THREE.Mesh, private lod: Omit<CoastLod, "index">, private k: { value: number }) {
    for (let g = 0; g < lod.groups; g++) {
      const b = lod.boxes.subarray(g * 6, g * 6 + 6);
      this.boxes.push(new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5])));
    }
    this.level = new Int8Array(lod.groups);
    this.stats.porNivel = lod.errors.map(() => 0);
    mesh.geometry.setDrawRange(0, lod.ranges[1]);
  }

  update(camera: THREE.PerspectiveCamera, viewportHeightPx: number) {
    const { ranges, errors, groups } = this.lod, L = errors.length, k = this.k.value;
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m);
    const pxPerRad = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const box = new THREE.Box3();
    const per = errors.map(() => 0);
    let culled = 0;
    for (let g = 0; g < groups; g++) {
      this.level[g] = -1;
      if (ranges[g * 2 + 1] === 0) continue;
      // alturas con la exageración vertical (la malla se escala en y); margen como el del LOD de bloques
      box.copy(this.boxes[g]);
      box.min.y = box.min.y * k - 1;
      box.max.y = box.max.y * k + 5;
      if (!this.frustum.intersectsBox(box)) { culled++; continue; }
      const d = Math.max(1, box.distanceToPoint(camera.position));
      let l = 0;
      // error vertical también exagerado: se usa el mayor de los dos (conservador)
      while (l < L - 1 && (errors[l + 1] * Math.max(1, k) / d) * pxPerRad <= this.maxErrorPx) l++;
      this.level[g] = l;
      per[l]++;
    }
    // Tramos: por nivel, grupos seguidos (contiguos en el índice) con ese nivel.
    const runs: [number, number][] = [];
    let tris = 0;
    for (let l = 0; l < L; l++) {
      let start = -1, end = -1;
      for (let g = 0; g < groups; g++) {
        const i = (l * groups + g) * 2, s = ranges[i], n = ranges[i + 1];
        if (this.level[g] === l && n > 0) {
          if (start >= 0 && s === end) end = s + n;
          else { if (start >= 0) runs.push([start, end - start]); start = s; end = s + n; }
          tris += n / 3;
        } else if (n > 0 && start >= 0) { runs.push([start, end - start]); start = -1; }
      }
      if (start >= 0) runs.push([start, end - start]);
    }
    const geo = this.mesh.geometry;
    if (runs.length) geo.setDrawRange(runs[0][0], runs[0][1]); else geo.setDrawRange(0, 0);
    while (this.extra.length < runs.length - 1) this.extra.push(this.sibling());
    this.extra.forEach((e, i) => {
      const r = runs[i + 1];
      e.material = this.mesh.material; // sigue al estilo y la variante
      e.scale.copy(this.mesh.scale);
      e.geometry.setDrawRange(r ? r[0] : 0, r ? r[1] : 0);
      e.visible = !!r && this.mesh.visible;
    });
    this.stats.porNivel = per;
    this.stats.triangulos = tris;
    this.stats.tramos = runs.length;
    this.stats.descartados = culled;
  }

  private sibling() {
    const src = this.mesh.geometry, g = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, a);
    g.setIndex(src.index);
    g.boundingSphere = src.boundingSphere;
    g.boundingBox = src.boundingBox;
    const e = new THREE.Mesh(g, this.mesh.material);
    e.name = "terreno-rema-tramo";
    e.matrixAutoUpdate = this.mesh.matrixAutoUpdate;
    this.mesh.parent!.add(e);
    return e;
  }

  dispose() {
    // Sin geometry.dispose(): borraría de la GPU los buffers compartidos con la malla costera (los libera ella).
    for (const e of this.extra) e.removeFromParent();
    this.extra = [];
  }
}
