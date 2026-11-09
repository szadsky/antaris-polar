import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import fs from "node:fs/promises";
// Use the same decoder and mesh construction as the viewer at build time.
export async function bake(dir,meta,level,vector) {
  const file = new URL("../src/worker.ts",import.meta.url);
  const {outputFiles}=await build({entryPoints:[(await import("node:url")).fileURLToPath(file)],bundle:true,write:false,format:"esm"});
  globalThis.self={};
  await import("data:text/javascript;base64,"+Buffer.from(outputFiles[0].contents).toString("base64")+"#"+level.name);
  for(const full of [false,true]) {
    let m; self.postMessage=result=>m=result;
    await self.onmessage({data:{type:"build",key:level.name,bin:await fs.readFile(new URL(level.file,dir)),
      sdf:await fs.readFile(new URL("costa-"+level.name+".sdf.gz",dir)),vector,width:level.width,height:level.height,
      cellSizeM:level.cellSizeM,stepM:meta.heights.stepM,seaDatum:meta.geoid.egm2008-meta.heights.minM,stride:2,exaggeration:1,sun:[0.4,0.6,0.7],full}});
    if(m.type!=="built")throw Error(m.message);
    const {positions:p,index,tileKinds}=m;
    const n=p.length/3;
    const parts=[new Uint32Array([0x314d5041,n,index.length,tileKinds.length,m.mesh.width,m.mesh.height]),p,index,tileKinds];
    const packed=gzipSync(Buffer.concat(parts.map(a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength))),{level:9});
    const mode=full?"completa":"lod";
    await fs.writeFile(new URL("malla-"+level.name+"-"+mode+".bin.gz",dir),packed);
    console.log(level.name,mode,index.length/3,"triángulos",packed.length,"bytes");
  }
}

