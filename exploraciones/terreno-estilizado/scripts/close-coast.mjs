import {gunzipSync} from "node:zlib";

// Interpretive continuation of exposed coastline; existing terrain positions stay intact.
export function closeCoast(m,vector,level,sea){

 const coast=vector ? JSON.parse(gunzipSync(vector)) : {nx:m.mesh.width-1,ny:m.mesh.height-1,runs:[],cuts:[]},solid=new Uint8Array(coast.nx*coast.ny),cuts=new Map(coast.cuts);
 for(const [i,n] of coast.runs)solid.fill(1,i,i+n);
 const cell=2*level.cellSizeM;
 function land(x,z){
  const gx=x/cell+coast.nx/2,gz=z/cell+coast.ny/2,ix=Math.floor(gx),iz=Math.floor(gz);
  if(ix<0||iz<0||ix>=coast.nx||iz>=coast.ny)return true;
  const id=iz*coast.nx+ix,faces=cuts.get(id);
  if(!faces)return vector ? !!solid[id] : !!m.meshLand[iz*m.mesh.width+ix];
  const u=gx-ix,v=gz-iz;
  for(let i=0;i<faces.length;i+=7){
   let inside=true;
   for(let j=0;j<3;j++){
    const a=i+1+2*j,b=i+1+2*((j+1)%3);
    if((faces[b]-faces[a])*(v-faces[a+1])-(faces[b+1]-faces[a+1])*(u-faces[a])>1e-9){inside=false;break;}
   }
   if(inside)return true;
  }
  return false;
 }
 const outside=(x,z)=>Math.abs(x)>coast.nx*cell/2 || Math.abs(z)>coast.ny*cell/2;
 const p=Array.from(m.positions),indices=Array.from(m.index),coords=new Map(),edges=new Map(),bottom=new Map();
 function canonical(i){
  const key=[p[3*i],p[3*i+1],p[3*i+2]].map(v=>Math.round(v*1000)).join(",");
  if(!coords.has(key))coords.set(key,i);
  return coords.get(key);
 }
 for(let j=0;j<m.index.length;j+=3)for(let k=0;k<3;k++){
  const a=canonical(m.index[j+k]),b=canonical(m.index[j+(k+1)%3]),key=Math.min(a,b)+":"+Math.max(a,b);
  const e=edges.get(key);if(e)e.count++;else edges.set(key,{a,b,count:1});
 }
 // Complete outer edges omitted from the baked coastal mesh by instanced land tiles.
 const w=m.mesh.width,h=m.mesh.height;
 function perimeter(a,b,id){
  if(vector ? (!solid[id] || cuts.has(id)) : (!m.meshLand[a] || !m.meshLand[b]))return;
  const ids=[a,b].map(i=>{const x=(i%w)*cell-coast.nx*cell/2,z=Math.floor(i/w)*cell-coast.ny*cell/2;
   const y=m.heightsM[Math.floor(i/w)*2*level.width+(i%w)*2];
   if(!Number.isFinite(y))return -1;
   const key=[x,y,z].map(v=>Math.round(v*1000)).join(',');
   if(coords.has(key))return coords.get(key);
   const n=p.length/3;p.push(x,y,z);coords.set(key,n);return n;});
  if(ids.includes(-1))return;
  const key=Math.min(...ids)+':'+Math.max(...ids);
  if(!edges.has(key))edges.set(key,{a:ids[0],b:ids[1],count:1});
 }
 for(let x=0;x<w-1;x++){perimeter(x+1,x,x);perimeter((h-1)*w+x,(h-1)*w+x+1,(h-2)*(w-1)+x);}
 for(let z=0;z<h-1;z++){perimeter(z*w,(z+1)*w,z*(w-1));perimeter((z+1)*w+w-1,z*w+w-1,z*(w-1)+w-2);}
 function toe(i){if(!bottom.has(i)){bottom.set(i,p.length/3);p.push(p[3*i],Math.min(p[3*i+1],Math.fround(sea-2)),p[3*i+2]);}return bottom.get(i);}
 let added=0;
 for(const {a,b,count} of edges.values()){
  if(count!==1||Math.max(p[3*a+1],p[3*b+1])<=sea)continue;
  const x=(p[3*a]+p[3*b])/2,z=(p[3*a+2]+p[3*b+2])/2,dx=p[3*b]-p[3*a],dz=p[3*b+2]-p[3*a+2],len=Math.hypot(dx,dz);
  if(len<.001)continue;
  const ox=-dz/len*.03,oz=dx/len*.03;
  if(!outside(x+ox,z+oz) && (!vector || land(x+ox,z+oz)||!land(x-ox,z-oz)))continue;
  const ta=toe(a),tb=toe(b);
  if(p[3*a+1]>p[3*ta+1]){indices.push(b,a,ta);added++;}
  if(p[3*b+1]>p[3*tb+1]){indices.push(b,ta,tb);added++;}
 }
 console.log("Cierre costero interpretativo:",added,"triángulos");
 return {...m,positions:Float32Array.from(p),index:Uint32Array.from(indices)};
}
