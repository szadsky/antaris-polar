import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/terrain-coordinates.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {projectedToTerrain,sampleTerrainHeight}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const meta=JSON.parse(await fs.readFile(new URL('../../terreno-nitidez/public/terreno/brown/terreno.json',import.meta.url),'utf8'));
for(const l of meta.levels){const stride=2,width=(Math.floor((l.width-1)/stride))*stride*l.cellSizeM,depth=Math.floor((l.height-1)/stride)*stride*l.cellSizeM;const p=projectedToTerrain(...meta.base.projected,meta.origin,l.cellSizeM,width,depth);assert.equal(p.x,((meta.base.projected[0]-meta.origin[0])/l.cellSizeM-.5)*l.cellSizeM-width/2);assert.equal(p.z,((meta.origin[1]-meta.base.projected[1])/l.cellSizeM-.5)*l.cellSizeM-depth/2);const origin=projectedToTerrain(meta.origin[0]+l.cellSizeM*.5,meta.origin[1]-l.cellSizeM*.5,meta.origin,l.cellSizeM,width,depth);assert.equal(origin.col,0);assert.equal(origin.row,0);}
assert.equal(sampleTerrainHeight(new Float32Array([0,10,20,30]),2,2,.5,.5),15);
assert.equal(sampleTerrainHeight(new Float32Array([0,NaN,20,30]),2,2,.5,.5),null);
assert.equal(sampleTerrainHeight(new Float32Array(4),2,2,-.01,0),null);
const data=JSON.parse(await fs.readFile(new URL('../../terreno-nitidez/public/terreno/brown/buildings.json',import.meta.url),'utf8'));assert.equal(data.buildings.length,12);assert.equal(data.crs,'EPSG:3031');for(const b of data.buildings)for(const r of b.rings){assert.deepEqual(r[0],r.at(-1));assert(r.flat().every(Number.isFinite));}
console.log('PASS: pixel centres, axis orientation, metre scale, bilinear heights, NoData and 12 closed Brown footprints.');
