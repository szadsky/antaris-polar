import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Terrain } from "./terrain";

// Exhibition support; the only vertical faces follow the outside of the square.
export function createDiorama(withFooting = true) {
  const group=new THREE.Group();
  const footing=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x243941,roughness:.78}));
  // Corte lateral con color por vértice: roca donde hay tierra, agua donde el borde es mar (turquesa arriba,
  // azul profundo abajo). Antes era una pared oscura pareja.
  const section=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,fog:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));
  const ROCK_TOP=new THREE.Color("#6f767c"),ROCK_BOTTOM=new THREE.Color("#2b2f33");
  const WATER_TOP=new THREE.Color("#4f97a6"),WATER_BOTTOM=new THREE.Color("#0c2a35");
  group.add(section);
  if(withFooting) group.add(footing);
  let current:Terrain|undefined;
  function update(t:Terrain,k:number) {
    const {width,height}=t.meshSize,cell=t.level.cellSizeM*2;
    const sea=(t.seaLevelM??0)*k-.03,thickness=t.widthM*.022;
    if(withFooting && current!==t){
      footing.geometry.dispose();
      footing.geometry=new RoundedBoxGeometry(t.widthM+cell*2,t.widthM*.018,t.depthM+cell*2,2,cell);
      current=t;
    }
    footing.position.y=sea-thickness-t.widthM*.009;
    const pos:number[]=[],col:number[]=[],idx:number[]=[];
    // La malla costera del terreno cierra el bloque con su propia pared exactamente en el borde: si el corte
    // queda en el mismo plano, las dos se pelean por la profundidad (rayado vertical con huecos). El corte se
    // corre unos metros hacia afuera para taparla siempre; a la distancia del diorama no se nota el escalón.
    const out=Math.max(1,t.widthM*.0004);
    const point=(x:number,z:number)=>{
      const sample=t.heightsM[z*2*t.level.width+x*2];
      const water=!Number.isFinite(sample)||sample*k<=sea+0.05;
      const top=Number.isFinite(sample)?Math.max(sea,sample*k):sea;
      const px=x*cell-t.widthM/2+(x===0?-out:x===width-1?out:0);
      const pz=z*cell-t.depthM/2+(z===0?-out:z===height-1?out:0);
      pos.push(px,top,pz,px,withFooting ? sea-thickness : sea-1,pz);
      const a=water?WATER_TOP:ROCK_TOP,b=water?WATER_BOTTOM:ROCK_BOTTOM;
      col.push(a.r,a.g,a.b,b.r,b.g,b.b);
    };
    for(let x=0;x<width;x++)point(x,0);
    for(let z=1;z<height;z++)point(width-1,z);
    for(let x=width-2;x>=0;x--)point(x,height-1);
    for(let z=height-2;z>0;z--)point(0,z);
    const n=pos.length/3;
    for(let a=0;a<n;a+=2){const b=(a+2)%n;idx.push(a,b,a+1,b,b+1,a+1);}
    // Close the existing outward offset with a top collar instead of leaving a sky-visible slit.
    const topStart=pos.length/3;
    for(let a=0;a<n;a+=2){const i=a*3;pos.push(Math.max(-t.widthM/2,Math.min(t.widthM/2,pos[i])),pos[i+1],Math.max(-t.depthM/2,Math.min(t.depthM/2,pos[i+2])));col.push(col[i],col[i+1],col[i+2]);}
    for(let a=0;a<n;a+=2){const b=(a+2)%n,ia=topStart+a/2,ib=topStart+b/2;idx.push(a,ia,b,b,ia,ib);}
    section.geometry.dispose();
    section.geometry=new THREE.BufferGeometry();
    section.geometry.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    section.geometry.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
    section.geometry.setIndex(idx);section.geometry.computeVertexNormals();
  }
  return {group,update};
}

