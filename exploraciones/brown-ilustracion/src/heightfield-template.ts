import * as THREE from 'three';
import {TILE} from './tile-size';

/** Indexed heightfield with an identical native-sample perimeter at every LOD. */
export function heightfieldTemplate(step:number,width=TILE,height=TILE){
  if(step<1||width%step||height%step)throw Error('Invalid heightfield dimensions');
  const positions:number[]=[],indices:number[]=[],shared=new Map<string,number>();
  const vertex=(x:number,y:number)=>{const key=x+','+y;let i=shared.get(key);if(i===undefined){i=positions.length/3;positions.push(x,y,0);shared.set(key,i);}return i;};
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    const edge=step>1&&(x===0||y===0||x+step===width||y+step===height);
    if(!edge){const a=vertex(x,y),b=vertex(x,y+step),c=vertex(x+step,y+step),d=vertex(x+step,y);indices.push(a,b,d,b,c,d);continue;}
    const center=vertex(x+step/2,y+step/2),ring:number[]=[];
    const side=(sx:number,sy:number,dx:number,dy:number,split:boolean)=>{const count=split?step:1;for(let k=0;k<count;k++)ring.push(vertex(sx+dx*k/count,sy+dy*k/count));};
    side(x,y,0,step,x===0);side(x,y+step,step,0,y+step===height);side(x+step,y+step,0,-step,x+step===width);side(x+step,y,-step,0,y===0);
    for(let k=0;k<ring.length;k++)indices.push(center,ring[k],ring[(k+1)%ring.length]);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  const normals=new Float32Array(positions.length);for(let i=1;i<normals.length;i+=3)normals[i]=1;
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));geometry.setIndex(new THREE.Uint16BufferAttribute(indices,1));return geometry;
}
