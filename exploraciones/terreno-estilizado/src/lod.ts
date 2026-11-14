import {heightfieldTemplate} from "./heightfield-template";
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
 * - Perímetros nativos compartidos unen todos los niveles sin faldones.
 */

import { TILE as CHUNK } from "./tile-size";
export { CHUNK }; // celdas por lado de bloque
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
  lastLevel?: number;
  width: number;
  height: number;
  box: THREE.Box3;
  center: THREE.Vector3;
}

export interface LodStats {
  visibles: number;
  descartados: number;
  porNivel: number[];
  triangulos: number;
  /** Malla costera con niveles de detalle (coast-lod.ts): grupos por nivel, triángulos dibujados y tramos. */
  costa?: { porNivel: number[]; triangulos: number; tramos: number; descartados: number };
}

export class ChunkedTerrain {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  private chunks: Chunk[] = [];
  private offsets: THREE.InstancedBufferAttribute[] = [];
  private trisPerInstance: number[] = [];
  private batchLevels: number[] = [];
  private batches = new Map<string,number>();
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
    tileKinds: Uint8Array,
    private mw: number,
    private mh: number,
    private cell: number,
    materials: THREE.Material[],
    private k = 1,
    exactCoast = false
  ) {
    const halfW = ((mw - 1) * cell) / 2;
    const halfD = ((mh - 1) * cell) / 2;
    for (let row = 0; row < mh - 1; row += CHUNK) {
      for (let col = 0; col < mw - 1; col += CHUNK) {
        if (tileKinds[Math.floor(row / CHUNK) * Math.ceil((mw - 1) / CHUNK) + Math.floor(col / CHUNK)] !== 1) continue;
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
          col, row, minH, maxH, width:Math.min(CHUNK,mw-1-col),height:Math.min(CHUNK,mh-1-row),
          allSea: !exactCoast && landNear === 0,
          coast: landCount > 0 && landCount < total,
          box: new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1)),
          center: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2),
        });
      }
    }
    const dimensions=new Map<string,{width:number;height:number;count:number}>();
    for(const c of this.chunks){const key=c.width+','+c.height,d=dimensions.get(key);if(d)d.count++;else dimensions.set(key,{width:c.width,height:c.height,count:1});}
    const native=heightfieldTemplate(1),nativePosition=native.getAttribute('position');
    const nativeIds=new Map<string,number>();for(let i=0;i<nativePosition.count;i++)nativeIds.set(nativePosition.getX(i)+','+nativePosition.getY(i),i);
    for(const {width,height,count} of dimensions.values())for(let li=0;li<(width===CHUNK&&height===CHUNK?STEPS.length:1);li++){
      const geo=heightfieldTemplate(STEPS[li],width,height);
      if(li===0){
        const p=geo.getAttribute('position'),old=geo.index!,index=new Uint16Array(old.count);
        for(let i=0;i<index.length;i++){const v=old.getX(i);index[i]=nativeIds.get(p.getX(v)+','+p.getY(v))!;}
        geo.setIndex(new THREE.BufferAttribute(index,1));geo.setAttribute('position',nativePosition);geo.setAttribute('normal',native.getAttribute('normal'));
      }
      const offs=new THREE.InstancedBufferAttribute(new Float32Array(count*2),2);offs.setUsage(THREE.DynamicDrawUsage);geo.setAttribute('chunk',offs);
      const mesh=new THREE.InstancedMesh(geo,materials[li],count);mesh.frustumCulled=false;mesh.count=0;mesh.name='terreno-lod'+li;
      this.batches.set(li+':'+width+':'+height,this.meshes.length);this.batchLevels.push(li);
      this.meshes.push(mesh);this.offsets.push(offs);this.trisPerInstance.push(geo.index!.count/3);this.group.add(mesh);
    }
    this.setExaggeration(k);
  }

  setMaterials(materials: THREE.Material[]) {
    this.meshes.forEach((m, i) => (m.material = materials[this.batchLevels[i]]));
  }

  setExaggeration(k: number) {
    this.k = k;
    for (const c of this.chunks) {
      // margen para faldones y para el cierre del borde
      c.box.min.y = c.minH * k - 1;
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
    const counts = this.meshes.map(()=>0),levels=[0,0,0,0];
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
      if (c.lastLevel !== undefined && li !== c.lastLevel) {
        const boundary = STEPS[Math.max(li,c.lastLevel)] * cellPx;
        if (Math.abs(boundary-this.targetPx)<this.targetPx*.12) li=c.lastLevel;
      }
      if (c.col + CHUNK > this.mw - 1 || c.row + CHUNK > this.mh - 1) li = 0;
      c.lastLevel = li;
      const batch=this.batches.get(li+":"+c.width+":"+c.height)!;
      this.offsets[batch].setXY(counts[batch], c.col, c.row);
      counts[batch]++;levels[li]++;
    }
    let tris = 0;
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      this.offsets[i].needsUpdate = true;
      tris += counts[i] * this.trisPerInstance[i];
    });
    this.stats = { visibles: this.chunks.length - culled, descartados: culled, porNivel: levels, triangulos: tris };
    void this.tmp;
  }

  /** Bytes en GPU de la geometría (plantillas + desplazamientos de instancia). */
  geometryBytes() {
    let b = 0;const seen=new Set<unknown>();
    for (const m of this.meshes) {
      const g = m.geometry;
      b += g.index!.array.byteLength+m.instanceMatrix.array.byteLength;
      for (const a of Object.values(g.attributes)) if(!seen.has(a)){b += (a as THREE.BufferAttribute).array.byteLength;seen.add(a);}
    }
    return b;
  }

  get chunkCount() {
    return this.chunks.length;
  }

  dispose() {
    for (const m of this.meshes){m.geometry.dispose();m.dispose();}
  }
}

