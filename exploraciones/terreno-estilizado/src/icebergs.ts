import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import type {Terrain} from './terrain';
const MAX_BERGS=12;
const WATER_AREA_PER_BERG=2_750_000;
export const BERG_FORMS=['Tabular','Domo','Cuña'] as const;
/** Closed radial meshes, in metres; submerged geometry belongs to the iceberg, not the DEM. */
export function icebergGeometry(kind:number){
 const segments=64,positions:number[]=[],indices:number[]=[],colors:number[]=[];
 const white=new THREE.Color('#edf3f4'),blue=new THREE.Color('#8cbcca');
 const rx=kind===0?61:48,rz=kind===0?43:35;
 const rings=[{r:0,y:-74},{r:.65,y:-65},{r:1.13,y:-30},{r:1.06,y:-8},{r:1,y:0},...Array.from({length:12},(_,i)=>({r:.98*(1-i/12),y:NaN})),{r:0,y:NaN}];
 for(let j=0;j<rings.length;j++)for(let k=0;k<segments;k++){
 const a=k/segments*Math.PI*2,r=rings[j].r;
 const boundary=1+.055*Math.sin(a*3+kind)+.025*Math.cos(a*7+.6);
 const x=rx*r*Math.cos(a)*boundary,z=rz*r*Math.sin(a)*boundary;
 let y=rings[j].y;
 if(!Number.isFinite(y)){
 const nx=x/rx,nz=z/rz;
 if(kind===0)y=18+.12*Math.sin(nx*3+nz)*Math.cos(nz*4);
 else if(kind===1)y=12+16*Math.sqrt(Math.max(0,1-r*r))*(1+.04*nx);
 else if(kind===2)y=5+34*(nx+1.1)/2.2;
 else y=7+36*Math.exp(-((nx+.32)**2+(nz-.06)**2)*11)+23*Math.exp(-((nx-.40)**2+(nz+.12)**2)*20);

 }
 positions.push(x,y,z);
 const shade=Math.max(0,Math.min(1,(y+4)/22));const c=blue.clone().lerp(white,shade*.86+.08);colors.push(c.r,c.g,c.b);
 }
 for(let j=0;j<rings.length-1;j++)for(let k=0;k<segments;k++){const n=(k+1)%segments,a=j*segments+k,b=j*segments+n,c=(j+1)*segments+k,d=(j+1)*segments+n;
 if(j===0)indices.push(a,c,d);else if(j===rings.length-2)indices.push(a,c,b);else indices.push(a,c,b,b,c,d);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);const welded=mergeVertices(g,1e-4);g.dispose();welded.computeVertexNormals();welded.computeBoundingSphere();return welded;
}
export function icebergLayout(t:Terrain,near:THREE.Vector3){
 const started=performance.now();
 const image=t.styleUniforms.uSurface.value.image as {data:Uint8Array;width:number;height:number};const {data,width:w,height:h}=image,cell=t.level.cellSizeM;
 const spots:THREE.Vector3[]=[];
 // Coarse summed-area rejection/acceptance: ~1 MiB scratch at 4 m, never uploaded.
 // Empty bounding squares are certainly clear; ambiguous coastline cells use the exact disk test.
 const block=4,cw=Math.ceil(w/block),ch=Math.ceil(h/block),pitch=cw+1,integral=new Uint32Array(pitch*(ch+1));
 for(let row=0;row<h;row++)for(let col=0;col<w;col++){const a=data[(row*w+col)*4+3];if(a===0||a>=112)integral[(Math.floor(row/block)+1)*pitch+Math.floor(col/block)+1]++;}
 for(let row=1;row<=ch;row++){let sum=0;for(let col=1;col<=cw;col++){const i=row*pitch+col;sum+=integral[i];integral[i]=sum+integral[i-pitch];}}
 const squareClear=(x:number,z:number)=>{const x0=Math.floor(((x-350+t.widthM/2)/cell)/block),z0=Math.floor(((z-350+t.depthM/2)/cell)/block),x1=Math.ceil(((x+350+t.widthM/2)/cell+1)/block),z1=Math.ceil(((z+350+t.depthM/2)/cell+1)/block);if(x0<1||z0<1||x1>cw-1||z1>ch-1)return false;return integral[z1*pitch+x1]-integral[z0*pitch+x1]-integral[z1*pitch+x0]+integral[z0*pitch+x0]===0;};
 // A 350 m disk around every centre must be classified as sea by the existing coast mask.
 const clear=(x:number,z:number)=>{if(squareClear(x,z))return true;for(let dz=-350;dz<=350;dz+=cell)for(let dx=-350;dx<=350;dx+=cell){if(dx*dx+dz*dz>350*350)continue;const col=Math.round((x+dx+t.widthM/2)/cell),row=Math.round((z+dz+t.depthM/2)/cell);if(col<2||row<2||col>=w-2||row>=h-2)return false;const alpha=data[(row*w+col)*4+3];if(alpha===0||alpha>=112)return false;}return true;};
 const candidates:THREE.Vector3[]=[];
 // Seeded continuous candidates: no underlying rows or regular angular slots.
 const hash=(x:number,z:number)=>{const v=Math.sin(x*12.9898+z*78.233)*43758.5453;return v-Math.floor(v);};
 const edge=450;
 for(let i=0;i<1200;i++){
  const x=(hash(i+1,31)-.5)*(t.widthM-edge*2);
  const z=(hash(i+1,79)-.5)*(t.depthM-edge*2);
  if(clear(x,z))candidates.push(new THREE.Vector3(x,0,z));
 }
 const usableWaterArea=candidates.length/1200*(t.widthM-edge*2)*(t.depthM-edge*2);
 const targetCount=candidates.length?Math.min(MAX_BERGS,Math.max(1,Math.round(usableWaterArea/WATER_AREA_PER_BERG))):0;
 candidates.sort((a,b)=>a.distanceToSquared(near)-b.distanceToSquared(near));
 // Find a compact patch of open water, then use unequal neighbour distances instead of
 // maximising the footprint across the entire map. Keep the same coastal clearance.
 for(const anchor of candidates.slice(0,40)){
  const group=[anchor],pool=candidates.filter(p=>p!==anchor&&p.distanceTo(anchor)<3000);
  while(group.length<targetCount){let best=-1,score=Infinity;
   // Mix loose pairs with isolated icebergs; do not optimise everyone to the same spacing.
   const preferred=[0,1650,580,1850,780,1200,680,1450,950,620,1300,800][group.length];
   pool.forEach((p,i)=>{const nearest=Math.min(...group.map(q=>p.distanceTo(q)));if(nearest<450)return;
    const value=Math.abs(nearest-preferred)+hash(p.x,p.z)*160+p.distanceTo(anchor)*.025;
    if(value<score){score=value;best=i;}
   });
   if(best<0)break;group.push(pool.splice(best,1)[0]);
  }
  if(group.length>spots.length){spots.splice(0,spots.length,...group);}
  if(spots.length===targetCount)break;
 }

 return {spots,usableWaterArea,targetCount,placementMs:performance.now()-started};
}
export function icebergLocations(t:Terrain,near:THREE.Vector3){return icebergLayout(t,near).spots;}
export function createIcebergs(){
 const group=new THREE.Group();group.name='Icebergs · prueba decorativa';
 const material=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.82,metalness:0});
 const geometries=BERG_FORMS.map((_,i)=>icebergGeometry(i));
 for(let i=0;i<MAX_BERGS;i++){const mesh=new THREE.Mesh(geometries[i%geometries.length],material);mesh.name=BERG_FORMS[i%BERG_FORMS.length]+' '+(Math.floor(i/3)+1);mesh.scale.setScalar([1,.9,1.05,.82,1.08,.92][i%6]);mesh.rotation.y=i*.79;mesh.visible=false;group.add(mesh);}
 let intensity=1;
 let lastLayout={usableWaterArea:0,targetCount:0,placementMs:0};
 const response=group.children.map(()=>({depth:0,velocity:0,tiltX:0,tiltZ:0,vx:0,vz:0}));
 return {group,
 stats(){const count=group.children.filter(m=>m.visible).length;return {...lastLayout,spots:undefined,count,triangles:count*geometries[0].index!.count/3,geometryBytes:geometries.reduce((sum,g)=>sum+g.index!.array.byteLength+Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0),0)};},
 get interacting(){return response.some(s=>Math.abs(s.depth)+Math.abs(s.velocity)+Math.abs(s.tiltX)+Math.abs(s.tiltZ)+Math.abs(s.vx)+Math.abs(s.vz)>.002);},
 push(object:THREE.Object3D,point?:THREE.Vector3){
  const i=group.children.indexOf(object);if(i<0||!group.visible||!object.visible)return false;
  const s=response[i],local=point?object.worldToLocal(point.clone()):new THREE.Vector3(15,0,10);
  s.velocity=Math.max(-12,s.velocity-10);
  const clamp=(v:number)=>Math.max(-.8,Math.min(.8,v));
  s.vx=clamp(s.vx+Math.max(-1,Math.min(1,local.z/30))*.65+.10);
  s.vz=clamp(s.vz-Math.max(-1,Math.min(1,local.x/45))*.65-.08);
  return true;
 },
 setIntensity(value:number){intensity=Math.max(.25,Math.min(1.5,value));},animate(seconds:number,dt=1/60){
   if(!group.visible)return false;
   let active=false;group.children.forEach((m,i)=>{if(!m.visible)return;active=true;
    const phase=i*2.17,s=response[i];
    const steps=Math.max(1,Math.ceil(Math.min(.1,Math.max(0,dt))*120)),h=Math.min(.1,Math.max(0,dt))/steps;
    for(let step=0;step<steps;step++){
     s.velocity+=(-7*s.depth-1.7*s.velocity)*h;s.depth+=s.velocity*h;
     if(s.depth< -4){s.depth=-4;s.velocity=Math.max(0,s.velocity);}
     if(s.depth>1.8){s.depth=1.8;s.velocity=Math.min(0,s.velocity);}
     s.vx+=(-9*s.tiltX-2.0*s.vx)*h;s.vz+=(-9*s.tiltZ-2.0*s.vz)*h;
     s.tiltX+=s.vx*h;s.tiltZ+=s.vz*h;
     if(Math.abs(s.tiltX)>.18){s.tiltX=Math.sign(s.tiltX)*.18;s.vx=0;}
     if(Math.abs(s.tiltZ)>.18){s.tiltZ=Math.sign(s.tiltZ)*.18;s.vz=0;}
    }
    if(Math.abs(s.tiltX)+Math.abs(s.tiltZ)+Math.abs(s.vx)+Math.abs(s.vz)<.001){s.tiltX=s.tiltZ=s.vx=s.vz=0;}
    if(Math.abs(s.depth)+Math.abs(s.velocity)<.002){s.depth=0;s.velocity=0;}
    const anchor=m.userData.anchor as THREE.Vector3|undefined;
    if(anchor){m.position.x=anchor.x+6*intensity*Math.sin(seconds*.30+phase);m.position.z=anchor.z+3*intensity*Math.sin(seconds*.36+phase+.4);}
    m.position.y=s.depth+intensity*(3*Math.sin(seconds*.70+phase)+.5*Math.sin(seconds*1.05+phase));
    m.rotation.x=s.tiltX+.045*intensity*Math.sin(seconds*.58+phase);
    m.rotation.z=s.tiltZ+.060*intensity*Math.sin(seconds*.65+phase+.7);
    m.updateMatrix();
   });if(active)group.updateMatrixWorld(true);return active;
 },bind(t:Terrain,near:THREE.Vector3){const layout=icebergLayout(t,near),spots=layout.spots;lastLayout=layout;group.children.forEach((m,i)=>{m.visible=!!spots[i];if(spots[i]){m.position.copy(spots[i]);m.userData.anchor=spots[i].clone();}});return spots.length;},setSea(y:number){group.position.y=y;},dispose(){geometries.forEach(g=>g.dispose());material.dispose();}};
}
