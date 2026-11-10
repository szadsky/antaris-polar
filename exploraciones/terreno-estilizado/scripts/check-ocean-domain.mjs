import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root='../terreno-nitidez/public/terreno/orcadas/',meta=JSON.parse(fs.readFileSync(root+'terreno.json'));
for(const level of meta.levels){
 const raw=gunzipSync(fs.readFileSync(root+level.file)),n=raw.length/2,w=level.width,q=new Uint16Array(n),rawS=gunzipSync(fs.readFileSync(root+'costa-'+level.name+'.sdf.gz')),s=new Uint8Array(n);
 for(let i=0;i<n;i++){q[i]=((i%w?q[i-1]:i>=w?q[i-w]:0)+raw[i]*256+raw[n+i])&65535;s[i]=((i%w?s[i-1]:i>=w?s[i-w]:0)+rawS[i])&255;}
 const data=JSON.parse(fs.readFileSync(root+level.oceanFile)),width=Math.floor((w-1)/2)*level.cellSizeM*2,sea=meta.geoid.egm2008-meta.heights.minM;
 const samples=[];for(let y=0;y<level.height;y++)for(let x=0;x<w;x++){const i=y*w+x;if(Math.hypot(x-w/2,y-level.height/2)*level.cellSizeM>250)continue;if(q[i]&&s[i]>=136&&(q[i]-1)*meta.heights.stepM<sea)samples.push([x*level.cellSizeM/width-.5,y*level.cellSizeM/width-.5]);}
 assert(samples.length>0,'No low-land regression samples');
 for(const [mode,{positions:p,indices:ix}]of Object.entries(data)){
  assert(p.every(Number.isFinite));assert(ix.every(i=>i>=0&&i<p.length/2));
  for(let j=0;j<ix.length;j+=3){const a=ix[j]*2,b=ix[j+1]*2,c=ix[j+2]*2;const cross=(p[b]-p[a])*(p[c+1]-p[a+1])-(p[b+1]-p[a+1])*(p[c]-p[a]);assert(cross<=0,'Winding must face up after Water rotation');for(const[x,y]of samples){const edge=(a,b)=>(p[b]-p[a])*(y-p[a+1])-(p[b+1]-p[a+1])*(x-p[a]);assert(!(edge(a,b)<-1e-13&&edge(b,c)<-1e-13&&edge(c,a)<-1e-13),'Ocean covers low ADD land');}}
  console.log(level.name,mode,samples.length+' low land samples remain outside ocean',ix.length/3+' triangles');
 }
}
