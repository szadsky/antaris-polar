import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import earcut, {flatten, deviation} from 'earcut';
import assert from 'node:assert/strict';
const id=process.argv[2]??'orcadas';
if(!/^[a-z0-9-]+$/.test(id))throw Error('Invalid base');
const dir=new URL('../../terreno-nitidez/public/terreno/'+id+'/',import.meta.url);
const meta=JSON.parse(await fs.readFile(new URL('terreno.json',dir)));
const src=JSON.parse(await fs.readFile(new URL('../../../data/costa/'+(id==='carlini'?'add-v7.12-potter-cove':id)+'.json',import.meta.url)));
assert.equal(src.spatialReference?.wkid??3031,3031);
for(const level of meta.levels){
 const cell=level.cellSizeM,width=Math.floor((level.width-1)/2)*cell*2,depth=Math.floor((level.height-1)/2)*cell*2;
 const cx=meta.origin[0]+cell/2+width/2,cy=meta.origin[1]-cell/2-depth/2;
 let land=[];
 for(const f of src.features){let part=[];for(const ring of f.geometry.rings){const r=ring.map(([x,y])=>[(x-cx)/width,(cy-y)/depth]);part=clip.xor(part,[r]);}land=clip.union(land,part);}
 const result={};
 for(const [mode,half]of [['diorama',.5],['landscape',4]]){
  const rect=[[[-half,-half],[half,-half],[half,half],[-half,half],[-half,-half]]];
  const water=clip.difference(rect,land),positions=[],indices=[];let area=0;
  for(const polygon of water){const flat=flatten(polygon),ix=earcut(flat.vertices,flat.holes,2);assert(deviation(flat.vertices,flat.holes,2,ix)<1e-7);const offset=positions.length/2;positions.push(...flat.vertices);for(let i=0;i<ix.length;i+=3){let a=ix[i],b=ix[i+1],c=ix[i+2];const p=flat.vertices;const cross=(p[b*2]-p[a*2])*(p[c*2+1]-p[a*2+1])-(p[b*2+1]-p[a*2+1])*(p[c*2]-p[a*2]);area+=Math.abs(cross)/2;if(cross>0)[b,c]=[c,b];indices.push(offset+a,offset+b,offset+c);}}
  assert.equal(clip.intersection(water,land).length,0,'Ocean overlaps ADD land');
  assert(positions.every(Number.isFinite));assert(indices.every(i=>i>=0&&i<positions.length/2));
  result[mode]={positions,indices};console.log(id,level.name,mode,{triangles:indices.length/3,geometryBytes:positions.length/2*12+indices.length*4,waterKm2:area*width*depth/1e6});
 }
 level.oceanFile='oceano-'+level.name+'.json';await fs.writeFile(new URL(level.oceanFile,dir),JSON.stringify(result));
}
await fs.writeFile(new URL('terreno.json',dir),JSON.stringify(meta,null,2)+'\n');
