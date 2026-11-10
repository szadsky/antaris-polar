import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {closeCoast} from './close-coast.mjs';
const level={cellSizeM:1,width:3};
function fixture(y=10){return {mesh:{width:2,height:2},heightsM:new Float32Array(9).fill(y),meshLand:new Uint8Array(4).fill(1),positions:new Float32Array([-1,y,-1,-1,y,1,1,y,-1,1,y,1]),index:new Uint32Array([0,1,2,1,3,2])};}
const vector=gzipSync(JSON.stringify({nx:1,ny:1,runs:[[0,1]],cuts:[]}));
test('Closes only external edges and preserves original surface',()=>{const m=fixture(),out=closeCoast(m,vector,level,0);assert.deepEqual(out.positions.slice(0,12),m.positions);assert.deepEqual(out.index.slice(0,6),m.index);assert.equal(out.index.length,30);for(let i=12;i<out.positions.length;i+=3)assert.equal(out.positions[i+1],-2);for(let j=6;j<out.index.length;j+=3){const [a,b,c]=Array.from(out.index.slice(j,j+3),i=>out.positions.slice(i*3,i*3+3));const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]);const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert(Math.hypot(...n)>0);assert(Math.abs(n[1])<1e-10);assert(n[0]*a[0]+n[2]*a[2]>0);}});
test('Does not close water',()=>{const m=fixture(-1);m.meshLand.fill(0);assert.deepEqual(closeCoast(m,undefined,level,0).index,m.index);});
test('Instanced perimeter matches full mesh closure',()=>{const m=fixture(),full=closeCoast(m,vector,level,0);const instanced=closeCoast({...m,index:new Uint32Array(0),positions:new Float32Array(0)},vector,level,0);const triangles=o=>Array.from({length:o.index.length/3},(_,j)=>Array.from(o.index.slice(j*3,j*3+3),i=>Array.from(o.positions.slice(i*3,i*3+3)).join(',')).sort().join(';')).sort();assert.deepEqual(triangles(instanced),triangles({...full,index:full.index.slice(6)}));});
test('Does not add walls on internal chunk boundaries',()=>{const m=fixture();m.mesh={width:4,height:4};m.meshLand=new Uint8Array(16);m.heightsM=new Float32Array(49).fill(10);assert.deepEqual(closeCoast(m,undefined,{cellSizeM:1,width:7},0).index,m.index);});

