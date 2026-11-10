import fs from 'node:fs';
import {gunzipSync as unzip} from 'node:zlib';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
try {
 const bundle=await build({stdin:{contents:"export * from './src/icebergs';export * as THREE from 'three';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
 const {icebergLayout,createIcebergs,THREE}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const root='../terreno-nitidez/public/terreno/',catalog=JSON.parse(fs.readFileSync(root+'index.json')),results=[];
 for(const base of catalog.bases){const dir=root+base.id+'/',meta=JSON.parse(fs.readFileSync(dir+'terreno.json'));
 for(const level of meta.levels){const w=level.width,h=level.height,sdf=unzip(fs.readFileSync(dir+'costa-'+level.name+'.sdf.gz')),q=new Uint8Array(w*h),dem=unzip(fs.readFileSync(dir+level.file)),hs=new Uint16Array(w*h),data=new Uint8Array(w*h*4);
 for(let i=0;i<q.length;i++){q[i]=((i%w?q[i-1]:i>=w?q[i-w]:0)+sdf[i])&255;hs[i]=((i%w?hs[i-1]:i>=w?hs[i-w]:0)+dem[i]*256+dem[q.length+i])&65535;data[i*4+3]=hs[i]?128+Math.max(-12,Math.min(12,q[i]-128))*8:0;}
 const cell=level.cellSizeM,widthM=Math.floor((w-1)/2)*cell*2,t={level,widthM,depthM:widthM,styleUniforms:{uSurface:{value:{image:{data,width:w,height:h}}}}};
 const near=new THREE.Vector3(meta.base.projected[0]-meta.origin[0]-cell/2-widthM/2,0,meta.origin[1]-meta.base.projected[1]-cell/2-widthM/2),layout=icebergLayout(t,near);
 assert.equal(layout.spots.length,layout.targetCount);assert(layout.targetCount<=12);
 if(base.id==='brown')assert.equal(layout.spots.length,8);
 for(let i=0;i<layout.spots.length;i++){const p=layout.spots[i];for(let j=i+1;j<layout.spots.length;j++)assert(p.distanceTo(layout.spots[j])>=450);
 // Independent exact check of coastal clearance, including NoData rejection.
 for(let dz=-350;dz<=350;dz+=cell)for(let dx=-350;dx<=350;dx+=cell){if(dx*dx+dz*dz>350*350)continue;const col=Math.round((p.x+dx+widthM/2)/cell),row=Math.round((p.z+dz+widthM/2)/cell),a=data[(row*w+col)*4+3];assert(col>=2&&row>=2&&col<w-2&&row<h-2&&a>0&&a<112);}}
 results.push({base:base.id,level:level.name,usableWaterKm2:+(layout.usableWaterArea/1e6).toFixed(2),count:layout.spots.length,placementMs:+layout.placementMs.toFixed(2)});
 }}
 const ice=createIcebergs();ice.group.children.forEach(m=>m.visible=true);for(let i=0;i<300;i++)ice.animate(i/60,1/60);
 const start=performance.now();for(let i=0;i<6000;i++)ice.animate(i/60,1/60);
 const report={note:'CPU measurements in Node; not browser FPS or GPU timings.',animationCpuMsPerStep:(performance.now()-start)/6000,maxGeometry:ice.stats(),bases:results};
 ice.dispose();fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/icebergs-performance.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} catch(error){console.error(error.message);process.exitCode=1;}
