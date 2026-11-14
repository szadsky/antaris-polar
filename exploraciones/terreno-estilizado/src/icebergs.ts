import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import type {Terrain} from './terrain';
import {STYL_RAMP,SNOW_GLINTS,SUN_SHADOW_LIGHTS} from './snow-light';
const MAX_BERGS=12;
const WATER_AREA_PER_BERG=2_750_000;
export const BERG_FORMS=['Tabular','Domo','Cuña','Pináculo'] as const;
/** Forma de cada uno de los 12 icebergs (índice en BERG_FORMS): mezcla fija, sin dos iguales seguidos. */
const BERG_KINDS=[0,1,2,0,3,1,2,0,3,1,0,2];

// Generador con semilla (mulberry32): la misma semilla da siempre la misma forma, en cualquier carga y nivel.
function rng(seed:number){let s=seed>>>0||1;return()=>{s=(s+0x6D2B79F5)>>>0;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
// Ruido de valor 3D suave (para las paredes y la superficie): sin grilla visible a la escala de un iceberg.
function noise3(seed:number){
 const h=(x:number,y:number,z:number)=>{const v=Math.sin(x*127.1+y*311.7+z*74.7+seed*13.37)*43758.5453;return v-Math.floor(v);};
 const s=(t:number)=>t*t*(3-2*t);
 return (x:number,y:number,z:number)=>{
  const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=s(x-xi),yf=s(y-yi),zf=s(z-zi);
  const l=(a:number,b:number,t:number)=>a+(b-a)*t;
  const c=(dx:number,dy:number,dz:number)=>h(xi+dx,yi+dy,zi+dz);
  return l(l(l(c(0,0,0),c(1,0,0),xf),l(c(0,1,0),c(1,1,0),xf),yf),l(l(c(0,0,1),c(1,0,1),xf),l(c(0,1,1),c(1,1,1),xf),yf),zf)*2-1;
 };
}

/**
 * Iceberg cerrado (metros; la parte sumergida es del iceberg, no del DEM). Reconstrucción artística, no un dato.
 * Simple y suave a propósito (rendimiento): 20 lados y 9 anillos (~280 triángulos). Cada semilla da una forma
 * propia: contorno con armónicos de fase al azar y entrantes anchos, talud con curvatura propia en vez de pared
 * vertical, superficie según el tipo (tabular, domo, cuña o pináculo) e inclinación propia. Se sombrea suave con
 * el material de la nieve del terreno (icebergMaterial).
 */
export function icebergGeometry(kind:number,seed=kind+1){
 const rand=rng(seed*9301+kind*49297+7),n3=noise3(seed*3.1+kind);
 const segments=20,positions:number[]=[],indices:number[]=[],colors:number[]=[];
 // tamaño (m) por tipo, con variación
 const base=[64,46,52,40][kind]*(.85+rand()*.3),aspect=[.62,.8,.7,.85][kind]+rand()*.18;
 const rx=base,rz=base*aspect,size=base/55;
 // contorno suave: armónicos 2–5 con fase al azar + 1 o 2 entrantes anchos
 const harm=Array.from({length:4},(_,i)=>({k:i+2,amp:.13/Math.pow(i+2,.7)*(.4+rand()),ph:rand()*Math.PI*2}));
 const dents=Array.from({length:1+Math.floor(rand()*2)},()=>({a:rand()*Math.PI*2,w:.3+rand()*.25,d:.08+rand()*.1}));
 const outline=(a:number)=>{let r=1;for(const h of harm)r+=h.amp*Math.cos(h.k*a+h.ph);for(const d of dents){const da=Math.atan2(Math.sin(a-d.a),Math.cos(a-d.a));r-=d.d*Math.exp(-(da*da)/(d.w*d.w));}return Math.max(.55,r);};
 // superficie según el tipo (nx, nz normalizados al contorno), sin detalle fino
 const tiltA=rand()*Math.PI*2,tilt=(rand()-.5)*.25;
 const lumps=Array.from({length:2},(_,i)=>({x:(rand()-.5)*.8,z:(rand()-.5)*.8,
  h:kind===3?(i===0?28+rand()*12:12+rand()*10):(i===0?14+rand()*9:6+rand()*7),s:kind===3?5+rand()*4:2.5+rand()*2}));
 const H0=[15+rand()*8,6,5,5][kind],wedge=26+rand()*10;
 const top=(nx:number,nz:number,r:number)=>{
  const along=nx*Math.cos(tiltA)+nz*Math.sin(tiltA);
  let y:number;
  if(kind===0)y=H0+along*tilt*30-2.5*r*r;
  else if(kind===2)y=H0+wedge*Math.min(1,Math.max(0,(along+1.05)/2.1))**1.3;
  else{y=H0;for(const l of lumps)y+=l.h*Math.exp(-((nx-l.x)**2+(nz-l.z)**2)*l.s);}
  return y+1.5*n3(nx*1.4+seed,.7,nz*1.4);
 };
 // talud sobre el agua (en vez de pared vertical): de la línea de flotación (r = 1) al borde de la superficie
 const slope=[.14+rand()*.12,.3+rand()*.15,.2+rand()*.12,.32+rand()*.14][kind],rTop=1-slope,bend=.6+rand()*1.1;
 const wallAt=(f:number)=>1-slope*Math.pow(f,bend);
 type Ring={r:number;y:number}|{f:number}|{t:number};
 // 9 anillos: 2 bajo el agua (casi no se ve), la línea de flotación, 3 de talud y 3 de superficie
 const rings:Ring[]=[{r:0,y:-60},{r:1.08,y:-22},{r:1,y:0},{f:.4},{f:.8},{f:1},{t:rTop*.66},{t:rTop*.33},{t:0}];
 for(let j=0;j<rings.length;j++)for(let k=0;k<segments;k++){
  const ring=rings[j],a=k/segments*Math.PI*2,o=outline(a),ca=Math.cos(a),sa=Math.sin(a);
  let y:number,r:number,wall=0;
  if('y' in ring){y=ring.y*size;r=ring.r*o;}
  else if('f' in ring){
   const H=top(rTop*o*ca,rTop*o*sa,1);y=ring.f*H;
   wall=n3(ca*1.8,y/14,sa*1.8);r=wallAt(ring.f)*o*(1+.06*wall); // salientes y huecos suaves
  }else{const rr=ring.t*o;y=top(rr*ca,rr*sa,ring.t/rTop);r=rr;}
  positions.push(rx*r*ca,y,rz*r*sa);
  // máscaras para el material (icebergMaterial): r = hueco de la pared (más azul), g = bajo el agua
  colors.push(wall<0?Math.min(1,-wall*1.6):0,Math.max(0,Math.min(1,-y/12)),0);
 }
 for(let j=0;j<rings.length-1;j++)for(let k=0;k<segments;k++){const n=(k+1)%segments,a=j*segments+k,b=j*segments+n,c=(j+1)*segments+k,d=(j+1)*segments+n;
  if(j===0)indices.push(a,c,d);else if(j===rings.length-2)indices.push(a,c,b);else indices.push(a,c,b,b,c,d);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);const welded=mergeVertices(g,1e-4);g.dispose();
 // inclinación propia: flota desparejo (2–6° el tabular, 4–10° el resto)
 const tiltDeg=(kind===0?2+rand()*4:4+rand()*6)*Math.PI/180,axisA=rand()*Math.PI*2;
 welded.applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.cos(axisA),0,Math.sin(axisA)),tiltDeg));
 welded.computeVertexNormals();welded.computeBoundingSphere();return welded;
}

/** Prueba de agua abierta: un disco de 350 m alrededor del punto, clasificado como mar por la máscara de costa. */
function seaClearance(t:Terrain){
 const image=t.styleUniforms.uSurface.value.image as {data:Uint8Array;width:number;height:number};const {data,width:w,height:h}=image,cell=t.level.cellSizeM;
 // Coarse summed-area rejection/acceptance: ~1 MiB scratch at 4 m, never uploaded.
 // Empty bounding squares are certainly clear; ambiguous coastline cells use the exact disk test.
 const block=4,cw=Math.ceil(w/block),ch=Math.ceil(h/block),pitch=cw+1,integral=new Uint32Array(pitch*(ch+1));
 for(let row=0;row<h;row++)for(let col=0;col<w;col++){const a=data[(row*w+col)*4+3];if(a===0||a>=112)integral[(Math.floor(row/block)+1)*pitch+Math.floor(col/block)+1]++;}
 for(let row=1;row<=ch;row++){let sum=0;for(let col=1;col<=cw;col++){const i=row*pitch+col;sum+=integral[i];integral[i]=sum+integral[i-pitch];}}
 const squareClear=(x:number,z:number)=>{const x0=Math.floor(((x-350+t.widthM/2)/cell)/block),z0=Math.floor(((z-350+t.depthM/2)/cell)/block),x1=Math.ceil(((x+350+t.widthM/2)/cell+1)/block),z1=Math.ceil(((z+350+t.depthM/2)/cell+1)/block);if(x0<1||z0<1||x1>cw-1||z1>ch-1)return false;return integral[z1*pitch+x1]-integral[z0*pitch+x1]-integral[z1*pitch+x0]+integral[z0*pitch+x0]===0;};
 return (x:number,z:number)=>{if(squareClear(x,z))return true;for(let dz=-350;dz<=350;dz+=cell)for(let dx=-350;dx<=350;dx+=cell){if(dx*dx+dz*dz>350*350)continue;const col=Math.round((x+dx+t.widthM/2)/cell),row=Math.round((z+dz+t.depthM/2)/cell);if(col<2||row<2||col>=w-2||row>=h-2)return false;const alpha=data[(row*w+col)*4+3];if(alpha===0||alpha>=112)return false;}return true;};
}
export function icebergLayout(t:Terrain,near:THREE.Vector3){
 const started=performance.now();
 const spots:THREE.Vector3[]=[];
 const clear=seaClearance(t);
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
/** Uniformes del terreno que usan los icebergs: en bind() apuntan a los mismos valores que t.styleUniforms. */
const SHARED_STYLE=['uSnow','uSnowShade','uIce','uSnowGlint','uSnowFwd','uStylize'] as const;
/**
 * Material de los icebergs con las propiedades de la nieve del terreno (shaders.ts): sus colores de nieve, sombra y
 * hielo, la luz envolvente, el reflejo con Fresnel, la dispersión hacia adelante y los destellos de cristales (sin el
 * grano de textura: el iceberg es chico en pantalla y así no lee texturas). Arriba nieve; en las paredes, mezcla de sombra de nieve y hielo; en
 * los huecos y bajo el agua, más hielo. Sombreado suave (sin caras planas).
 */
function icebergMaterial(){
 const U:Record<string,THREE.IUniform>={uSnow:{value:new THREE.Color(1,1,1)},uSnowShade:{value:new THREE.Color(.8,.85,.9)},uIce:{value:new THREE.Color(.5,.7,.8)},
  uSnowGlint:{value:new THREE.Vector4(1,16,5,.2)},uSnowFwd:{value:.25},uStylize:{value:new THREE.Vector4(0,.5,2,.35)}};
 const m=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.8,metalness:0});
 m.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,U);
  sh.vertexShader=sh.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vWorld;\nvarying vec3 vBergN;')
   .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\nvBergN=normalize(mat3(modelMatrix)*objectNormal);');
  sh.fragmentShader=sh.fragmentShader
   .replace('#include <common>',`#include <common>
uniform vec3 uSnow, uSnowShade, uIce;
uniform vec4 uSnowGlint, uStylize;
uniform float uSnowFwd;
varying vec3 vWorld;
varying vec3 vBergN;
float gSun = 1.0, gSnowK = 1.0, gGlit = 0.0;
vec3 gN = vec3(0.0, 1.0, 0.0), gGlitN = vec3(0.0, 0.0, 1.0);
${STYL_RAMP}`)
   .replace('#include <color_fragment>',`{
  vec3 nW = normalize(vBergN);
  gN = nW;
  float topK = smoothstep(0.35, 0.8, nW.y);
  vec3 col = mix(mix(uSnowShade, uIce, 0.45), uSnow, topK); // paredes: sombra de nieve con hielo · arriba: nieve
  col = mix(col, uIce * 0.85, vColor.r * 0.7);              // huecos de la pared
  col = mix(col, uIce * 0.55, vColor.g);                    // bajo el agua
  diffuseColor.rgb = col;
  gSnowK = 1.0 - vColor.g;
}
${SNOW_GLINTS}`)
   .replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);')
   .replace('#include <lights_fragment_begin>',SUN_SHADOW_LIGHTS);
 };
 m.customProgramCacheKey=()=>'iceberg-nieve-terreno';
 return {material:m,bind(t:Terrain){const su=t.styleUniforms as unknown as Record<string,THREE.IUniform>;for(const k of SHARED_STYLE)if(su[k])U[k].value=su[k].value;}};
}
export function createIcebergs(){
 const group=new THREE.Group();group.name='Icebergs · prueba decorativa';
 const ice=icebergMaterial(),material=ice.material;
 // una geometría propia por iceberg (semilla = índice): no hay dos iguales
 const geometries=BERG_KINDS.map((kind,i)=>icebergGeometry(kind,i+1));
 for(let i=0;i<MAX_BERGS;i++){const kind=BERG_KINDS[i];const mesh=new THREE.Mesh(geometries[i],material);mesh.name=BERG_FORMS[kind]+' '+(BERG_KINDS.slice(0,i+1).filter(k=>k===kind).length);mesh.rotation.y=i*.79+.3;mesh.visible=false;group.add(mesh);}
 let intensity=1;
 let lastLayout={usableWaterArea:0,targetCount:0,placementMs:0};
 // Ubicación fija por base: el primer nivel que llega (8 m) la decide y los siguientes (4 m) la conservan si sus
 // puntos siguen en agua abierta. Antes se recalculaba con cada nivel y los icebergs saltaban de lugar.
 let bound:{w:number;d:number;near:THREE.Vector3;spots:THREE.Vector3[]}|null=null;
 const response=group.children.map(()=>({depth:0,velocity:0,tiltX:0,tiltZ:0,vx:0,vz:0}));
 return {group,
 stats(){const visible=group.children.filter(m=>m.visible) as THREE.Mesh[];return {...lastLayout,spots:undefined,count:visible.length,triangles:visible.reduce((n,m)=>n+m.geometry.index!.count/3,0),geometryBytes:geometries.reduce((sum,g)=>sum+g.index!.array.byteLength+Object.values(g.attributes).reduce((n,a)=>n+a.array.byteLength,0),0)};},
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
 },bind(t:Terrain,near:THREE.Vector3){
  ice.bind(t);
  // misma base: entre niveles el recorte y la base se corren unos metros (medio píxel), con tolerancia de 50 m
  const same=!!bound&&Math.abs(bound.w-t.widthM)<50&&Math.abs(bound.d-t.depthM)<50&&bound.near.distanceTo(near)<50;
  let spots:THREE.Vector3[]|null=null;
  if(bound&&same){const clear=seaClearance(t);if(bound.spots.every(p=>clear(p.x,p.z)))spots=bound.spots;}
  if(!spots){const layout=icebergLayout(t,near);lastLayout=layout;spots=layout.spots;bound={w:t.widthM,d:t.depthM,near:near.clone(),spots};}
  group.children.forEach((m,i)=>{const p=spots![i];m.visible=!!p;if(!p)return;
   // mismo lugar: no se toca la posición (sigue flotando sin saltar)
   const a=m.userData.anchor as THREE.Vector3|undefined;if(a&&a.equals(p))return;
   m.position.copy(p);m.userData.anchor=p.clone();});
  return spots.length;
 },setSea(y:number){group.position.y=y;},dispose(){geometries.forEach(g=>g.dispose());material.dispose();}};
}
