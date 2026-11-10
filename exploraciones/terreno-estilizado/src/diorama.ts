import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Terrain } from "./terrain";

// Exhibition support; the only vertical faces follow the outside of the square.
export function createDiorama(withFooting = true) {
  const group=new THREE.Group();
  const footing=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x243941,roughness:.78}));
  const section=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x64757a,roughness:1,side:THREE.DoubleSide}));
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
    const pos:number[]=[],idx:number[]=[];
    const point=(x:number,z:number)=>{
      const sample=t.heightsM[z*2*t.level.width+x*2];
      const top=Number.isFinite(sample)?Math.max(sea,sample*k):sea;
      pos.push(x*cell-t.widthM/2,top,z*cell-t.depthM/2,x*cell-t.widthM/2,withFooting ? sea-thickness : sea-1,z*cell-t.depthM/2);
    };
    for(let x=0;x<width;x++)point(x,0);
    for(let z=1;z<height;z++)point(width-1,z);
    for(let x=width-2;x>=0;x--)point(x,height-1);
    for(let z=height-2;z>0;z--)point(0,z);
    const n=pos.length/3;
    for(let a=0;a<n;a+=2){const b=(a+2)%n;idx.push(a,b,a+1,b,b+1,a+1);}
    section.geometry.dispose();
    section.geometry=new THREE.BufferGeometry();
    section.geometry.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    section.geometry.setIndex(idx);section.geometry.computeVertexNormals();
  }
  return {group,update};
}

