import {build} from 'esbuild';import assert from 'node:assert/strict';
async function compiled(file){const {outputFiles}=await build({entryPoints:[file],bundle:true,write:false,format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].contents).toString('base64'));}
const {repairHeightfield}=await compiled('src/heightfield-repair.ts');
const plane=()=>Float32Array.from({length:81},(_,i)=>10+(i%9)*2+Math.floor(i/9)*3),land=new Uint8Array(81).fill(1);
let h=plane(),original=h.slice();h[40]=NaN;let r=repairHeightfield(h,9,9,land);assert.equal(h[40],original[40]);assert.deepEqual([...r.sources],[2]);for(let i=0;i<81;i++)assert.equal(h[i],original[i]);
h=plane();for(let y=3;y<6;y++)for(let x=3;x<6;x++)h[y*9+x]=NaN;r=repairHeightfield(h,9,9,land);assert.equal(r.remaining,9);assert.equal(r.indices.length,0);assert.equal(r.unresolved.length,1);
const coverage=plane();r=repairHeightfield(h,9,9,land,coverage);assert.equal(r.remaining,0);assert(r.sources.every(v=>v===1));
h=plane();h[0]=NaN;r=repairHeightfield(h,9,9,land);assert(Number.isNaN(h[0]));
h=plane();h[40]=NaN;const sea=land.slice();sea[41]=0;r=repairHeightfield(h,9,9,sea);assert(Number.isNaN(h[40]));
h=plane();h[40]=NaN;h[39]=300;h[41]=300;r=repairHeightfield(h,9,9,land);assert(Number.isNaN(h[40]));
let message;globalThis.self={postMessage:m=>{message=m;}};await compiled('src/worker.ts');
const q=Uint16Array.from({length:81},(_,i)=>101+(i%9)*4+Math.floor(i/9)*6);q[40]=0;const raw=new Uint8Array(162);for(let i=0;i<81;i++){const prev=i%9?q[i-1]:i>=9?q[i-9]:0,d=(q[i]-prev)&65535;raw[i]=d>>8;raw[81+i]=d&255;}
await self.onmessage({data:{type:'build',key:'repair-test',bin:raw.buffer,mask:land.buffer,width:9,height:9,cellSizeM:4,stepM:.5,seaDatum:-10,stride:2,exaggeration:1,sun:[.4,.6,.7],full:true}});assert.equal(message.type,'built',message.message);assert.equal(message.provenance.indices[0],40);assert.equal(message.heightsM[40],70);
await self.onmessage({data:{type:'release',key:'repair-test'}});await self.onmessage({data:{type:'update',key:'repair-test',exaggeration:1,sun:[.4,.6,.7]}});assert.equal(message.type,'error');assert.equal(message.key,'repair-test');
console.log('PASS: plano recuperado, datos válidos intactos, cobertura medida, huecos grandes/costa/acantilado sin inventar, procedencia y liberación del Worker.');
