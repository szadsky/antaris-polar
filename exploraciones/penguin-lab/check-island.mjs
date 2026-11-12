import assert from 'node:assert/strict';
import {TERRAINS,networkGeometry,IslandTerrain,findSpawn,baseRelief,MAX_WALK_SLOPE,SHORE_MARGIN} from './src/island/island-terrain.ts';
import {buildIslandMaps} from './src/island/island-maps.ts';
import {PenguinMotion} from './src/penguin-motion.ts';

/** Línea de costa de la malla (grilla de vértices, 10,9 cm) por marching squares, recorrida en orden.
 * Devuelve el giro máximo entre segmentos y los "dientes": pares de giros consecutivos de más de 20°
 * con signo opuesto. Una escalera de grilla los tiene en casi cada par; un cabo o una bahía, aunque
 * sean agudos, giran hacia un solo lado, y en una curva en S los giros son chicos en la inflexión. */
export function coastTurn(t){
 const m=t.iceN,s=4,h=(r,c)=>t.heights[(r*s)*t.n+c*s]-t.seaY,cell=t.cell*s,points=new Map(),links=new Map();
 const point=(key,x,z)=>{if(!points.has(key))points.set(key,[x,z]);return key;};
 const edge=(r0,c0,r1,c1)=>{const a=h(r0,c0),b=h(r1,c1);if((a>0)===(b>0))return null;const f=a/(a-b);return point(`${r0},${c0},${r1},${c1}`,(c0+(c1-c0)*f)*cell,(r0+(r1-r0)*f)*cell);};
 const link=(a,b)=>{for(const [p,q] of [[a,b],[b,a]]){if(!links.has(p))links.set(p,[]);links.get(p).push(q);}};
 for(let r=0;r<m-1;r++)for(let c=0;c<m-1;c++){
  const e=[edge(r,c,r,c+1),edge(r,c+1,r+1,c+1),edge(r+1,c,r+1,c+1),edge(r,c,r+1,c)].filter(Boolean);
  if(e.length===2)link(e[0],e[1]);
  else if(e.length===4){const center=(h(r,c)+h(r,c+1)+h(r+1,c)+h(r+1,c+1))/4;if((center>0)===(h(r,c)>0)){link(e[0],e[1]);link(e[2],e[3]);}else{link(e[0],e[3]);link(e[1],e[2]);}}
 }
 let max=0,teeth=0,segments=0;const visited=new Set();
 for(const start of links.keys()){
  if(visited.has(start))continue;
  // Recorre el contorno cerrado en orden, descartando puntos casi coincidentes (la costa pasa por un vértice).
  const chain=[];let prev=null,cur=start;
  while(cur&&!visited.has(cur)){visited.add(cur);const p=points.get(cur);if(!chain.length||Math.hypot(p[0]-chain.at(-1)[0],p[1]-chain.at(-1)[1])>cell*.2)chain.push(p);const next=links.get(cur).find(k=>k!==prev&&!visited.has(k));prev=cur;cur=next;}
  segments+=chain.length;
  const turns=[];
  for(let i=0;i<chain.length;i++){
   const a=chain[(i-1+chain.length)%chain.length],p=chain[i],b=chain[(i+1)%chain.length];
   const ux=p[0]-a[0],uz=p[1]-a[1],vx=b[0]-p[0],vz=b[1]-p[1];
   turns.push(Math.atan2(ux*vz-uz*vx,ux*vx+uz*vz)*180/Math.PI);
  }
  for(let i=0;i<turns.length;i++){
   max=Math.max(max,Math.abs(turns[i]));
   const next=turns[(i+1)%turns.length];
   if(Math.abs(turns[i])>20&&Math.abs(next)>20&&Math.sign(turns[i])!==Math.sign(next))teeth++;
  }
 }
 return {max,teeth,segments};
}

for(const spec of TERRAINS){
const started=performance.now(),t=new IslandTerrain(spec),genMs=performance.now()-started;
// Determinista; la grilla fina pasa exactamente por la grilla de generación (Catmull-Rom).
assert.deepEqual(new IslandTerrain(spec).heights.subarray(0,20000),t.heights.subarray(0,20000));
for(const [r,c] of [[40,40],[64,64],[90,30],[30,100]])assert(Math.abs(t.heights[(r*8)*t.n+c*8]-t.coarse[r*t.coarseN+c])<1e-5,'Fine grid must pass through the generated samples');
// La erosión cambió el relieve (valles), pero no la línea de costa base.
const base=baseRelief(spec,t.coarseN,t.half).heights;let carved=0;
for(let i=0;i<base.length;i++){if(base[i]>1&&base[i]-t.coarse[i]>.15)carved++;if(Math.abs(base[i])<.05)assert(Math.abs(t.coarse[i]-base[i])<.02,'Erosion must not move the coastline');}
assert(carved>150,`Erosion carved only ${carved} cells`);
// Composición: isla rodeada de agua, cerros medianos, hielo, roca y una llanura caminable.
for(const [x,z] of [[-t.half,-t.half],[t.half,t.half],[-t.half,t.half],[t.half,-t.half]])assert(t.sample(x,z)<-1,'Domain corners must be open water');
let land=0,ice=0,rock=0,maxH=-Infinity;
for(let r=0;r<t.n;r+=8)for(let c=0;c<t.n;c+=8){const x=c*t.cell-t.half,z=r*t.cell-t.half,h=t.sample(x,z);if(h<=0)continue;land++;maxH=Math.max(maxH,h);if(t.ice(x,z)>.5)ice++;if(t.slope(x,z)>1)rock++;}
const area=land*(8*t.cell)**2;
const domain=(2*t.half)**2;assert(area>domain*.25&&area<domain*.7,`Land area ${area.toFixed(0)} m² of ${domain.toFixed(0)} m²`);
assert(maxH>4*spec.heightScale&&maxH<8*spec.heightScale,`Highest peak ${maxH.toFixed(2)} m: not a medium mountain`);
assert(ice/land>.03,'Island must have glaciers');assert(rock/land>.05,'Island must have steep rock');
// Recorridos: lo caminable conectado con la aparición (relleno por inundación en una grilla de 20 cm).
const spawn=findSpawn(t),G=Math.round(2*t.half/.2),seen=new Uint8Array(G*G),stack=[],gi=(x,z)=>Math.round((z+t.half)/.2)*G+Math.round((x+t.half)/.2);
seen[gi(spawn.x,spawn.z)]=1;stack.push(gi(spawn.x,spawn.z));let reach=0;
while(stack.length){const i=stack.pop();reach++;const r=Math.floor(i/G),c=i%G;for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]]){const rr=r+dr,cc=c+dc,j=rr*G+cc;if(rr<0||cc<0||rr>=G||cc>=G||seen[j])continue;if(!t.canStand(cc*.2-t.half,rr*.2-t.half))continue;seen[j]=1;stack.push(j);}}
const reachM2=reach*.04;assert(reachM2>area*(spec.network?.3:.45),`Only ${reachM2.toFixed(0)} m² reachable from spawn`);
// Desde el inicio se puede llegar caminando a la orilla (en el valle, por la abertura).
let exitsToSea=false;
for(let i=0;i<seen.length&&!exitsToSea;i++)if(seen[i]&&t.sample((i%G)*.2-t.half,Math.floor(i/G)*.2-t.half)<.16)exitsToSea=true;
assert(exitsToSea,'No walkable route from the spawn to the shore');
// Pasadizos: todos los claros, el mirador (subiendo por el tobogán de hielo) y las playas (a menos de 5 m del
// nodo de salida, que está en el agua) se alcanzan a pie.
let networkInfo=null;
if(spec.network){const missing=[];let terraceTop=0;for(const [nx,nz,,fh,kind] of spec.network.nodes){let reached=false;const rr=kind==='salida'?5:1.2;for(let dz=-rr;dz<=rr&&!reached;dz+=.2)for(let dx=-rr;dx<=rr&&!reached;dx+=.2)if(Math.hypot(dx,dz)<=rr&&seen[gi(nx+dx,nz+dz)])reached=true;if(!reached)missing.push(kind+' '+nx+','+nz);if(kind==='mirador'&&reached)terraceTop=Math.max(terraceTop,t.sample(nx,nz));}assert(missing.length===0,'Not reachable on foot: '+missing.join('; '));
// Toboganes: pendiente caminable en todo el trayecto y altura que siempre baja (sin pozos ni lomos).
for(const e of networkGeometry(spec).edges.filter(e=>e.slide)){const up=e.ha>e.hb?e.pts:[...e.pts].reverse();let prev=Infinity;for(let p=2;p<up.length-2;p++){const [x,z]=up[p],h=t.sample(x,z);assert(t.slope(x,z)<=MAX_WALK_SLOPE,'Slide too steep at '+x.toFixed(1)+','+z.toFixed(1));assert(h<=prev+.05,'Slide goes up (dip) at '+x.toFixed(1)+','+z.toFixed(1));prev=Math.min(prev,h);}}networkInfo=`${spec.network.nodes.length} lugares conectados (${spec.network.edges.length} pasadizos y toboganes), mirador más alto a ${terraceTop.toFixed(1)} m · `;}
// Valle encerrado: rayos desde el centro del valle; cuentan como cerrados si cruzan montaña de más de 2,5 m
// antes de llegar al mar.
let enclosure=null;
if(spec.id==='valle'){
 const cx=-Math.sin(spec.viewAzimuth)*.9*spec.scale,cz=-Math.cos(spec.viewAzimuth)*.9*spec.scale;let closed=0;
 for(let k=0;k<72;k++){const a=k/72*Math.PI*2;let top=-Infinity;for(let s=0;s<14*spec.scale;s+=.1){const h=t.sample(cx+Math.sin(a)*s,cz+Math.cos(a)*s);if(h<0)break;top=Math.max(top,h);}if(top>2.5*spec.heightScale)closed++;}
 enclosure=closed/72;assert(enclosure>=.75,`Valley only ${(enclosure*100).toFixed(0)} % enclosed`);
}
// Costa sin dientes de sierra en la malla.
const coast=coastTurn(t);assert(coast.segments>300,'Coast must exist');assert(coast.teeth===0,`Coast has ${coast.teeth} sawtooth teeth`);assert(coast.max<40,`Coast turns ${coast.max.toFixed(1)}° in one segment`);
// Recorrido aleatorio: nunca en el agua ni en pendientes no caminables (caminar, correr, deslizar y saltar).
const motion=new PenguinMotion(Infinity,(x,z)=>t.canStand(x,z),(x,z)=>t.gradient(x,z),(x,z)=>t.ice(x,z));motion.setHome(spawn.x,spawn.z,spawn.yaw);
let seed=spec.seed,angle=0,minHeight=Infinity,maxSlope=0,distance=0;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
for(let i=0;i<30000;i++){
 if(i%90===0)angle=random()*Math.PI*2;
 if(i%400===0&&random()<.5)motion.jump();
 const px=motion.x,pz=motion.z;motion.step(Math.sin(angle),Math.cos(angle),random()<.3,1/60,i%1000>850);
 distance+=Math.hypot(motion.x-px,motion.z-pz);
 minHeight=Math.min(minHeight,t.sample(motion.x,motion.z));maxSlope=Math.max(maxSlope,t.slope(motion.x,motion.z));
}
assert(minHeight>SHORE_MARGIN,'Penguin entered the water');assert(maxSlope<=MAX_WALK_SLOPE+1e-9,'Penguin climbed a non-walkable slope');assert(distance>60,`Penguin got stuck: ${distance.toFixed(1)} m`);
// Texturas: la costa codificada coincide con el relieve; la sombra horneada está en rango; el fondo que no se
// dibuja (a más de 2,4 m de la costa) siempre queda bajo agua opaca (orilla < 0,75 → alfa 1).
const maps=buildIslandMaps(t,[-3,4.5,3.5]),c=Math.round((spawn.x+t.half)/t.cell),r=Math.round((spawn.z+t.half)/t.cell);
assert(maps.surface[(r*t.n+c)*4+3]>128,'Spawn must be land in the coast channel');
const M=maps.lightSize,lit=Array.from({length:M*M},(_,i)=>maps.light[i*4]);assert(lit.some(v=>v<64)&&lit.filter(v=>v>200).length>M*M*.8,'Baked sun shadow out of range');
for(let j=0;j<M;j++)for(let i=0;i<M;i++){const x=((i+.5)/M*t.n-.5)*t.cell-t.half,z=((j+.5)/M*t.n-.5)*t.cell-t.half,col=Math.round((x+t.half)/t.cell),row=Math.round((z+t.half)/t.cell);if(maps.sdf[row*t.n+col]<-2.25)assert(maps.light[(j*M+i)*4+1]<.75*255,'Culled seabed would show through translucent water');}
console.log(`${spec.name}: ${enclosure===null?'':`encerrado ${(enclosure*100).toFixed(0)} % · `}${networkInfo??''}${genMs.toFixed(0)} ms (erosión ${t.erosionMs.toFixed(0)} ms) · ${area.toFixed(0)} m² de tierra · cumbre ${maxH.toFixed(1)} m · hielo ${(ice/land*100).toFixed(0)} % · roca ${(rock/land*100).toFixed(0)} % · ${reachM2.toFixed(0)} m² caminables desde el inicio · costa ${coast.segments} segmentos, ${coast.teeth} dientes, giro máx. ${coast.max.toFixed(1)}° · recorrido ${distance.toFixed(0)} m sin agua (mín. ${minHeight.toFixed(2)} m)`);
}
console.log('PASS: macizo, valle encerrado y sendero erosionados, con cerros medianos, glaciares y roca; costa sin dientes; salida caminable al mar; el pingüino no entra al agua ni sube laderas.');
