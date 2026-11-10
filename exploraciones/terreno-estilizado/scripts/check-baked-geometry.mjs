import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root='../terreno-nitidez/public/terreno/';
let count=0,triangles=0;
for(const {id} of JSON.parse(fs.readFileSync(root+'index.json')).bases){
 const meta=JSON.parse(fs.readFileSync(root+id+'/terreno.json'));
 for(const l of meta.levels)for(const mode of ['lod','completa']){
  const b=gunzipSync(fs.readFileSync(root+id+'/malla-'+l.name+'-'+mode+'.bin.gz'));
  const n=b.readUInt32LE(4),ni=b.readUInt32LE(8),p=new Float32Array(n*3),ix=new Uint32Array(ni);
  for(let i=0;i<p.length;i++)p[i]=b.readFloatLE(24+i*4);
  for(let i=0;i<ni;i++)ix[i]=b.readUInt32LE(24+p.byteLength+i*4);
  assert(p.every(Number.isFinite),id);assert(ix.every(i=>i<n),id);
  let vertical=0;
  for(let i=0;i<ni;i+=3){let a=ix[i]*3,c=ix[i+1]*3,d=ix[i+2]*3;const ux=p[c]-p[a],uy=p[c+1]-p[a+1],uz=p[c+2]-p[a+2],vx=p[d]-p[a],vy=p[d+1]-p[a+1],vz=p[d+2]-p[a+2];const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;assert(Math.hypot(nx,ny,nz)>1e-10,id+' '+l.name+' '+mode+' degenerate '+i/3);if(Math.abs(ny)<1e-10)vertical++;}
  console.log(id,l.name,mode,'caras verticales:',vertical);count++;triangles+=ni/3;
 }
}
console.log({count,triangles});
