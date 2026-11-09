import ClipperLib from "clipper-lib";
import {reconcile} from "./brown-reconcile.mjs";
import {bake} from "./brown-bake.mjs";
import fs from "node:fs/promises";
import { gzipSync } from "node:zlib";
import clip from "polygon-clipping";
import earcut from "earcut";
import { rasterizeLand } from "../../terreno-nitidez/scripts/coastline.mjs";

const id=process.argv[2] ?? "brown";
if(!/^[a-z0-9-]+$/.test(id)) throw Error("Base inválida");
const dir = new URL(`../../terreno-nitidez/public/terreno/${id}/`, import.meta.url);
const meta = JSON.parse(await fs.readFile(new URL("terreno.json", dir)));
const {features} = JSON.parse(await fs.readFile(new URL(`../../../data/costa/${id==="carlini"?"add-v7.12-potter-cove":id}.json`, import.meta.url)));
const lines=JSON.parse(await fs.readFile(new URL(`../../../data/costa/${id}-lines.json`,import.meta.url)));
if(lines.spatialReference.wkid!==3031 || lines.exceededTransferLimit)throw Error("Referencia de líneas inválida");
const stride = 2, tile = 32;
for (const level of meta.levels) {
  const step = level.cellSizeM * stride;
  const nx = Math.floor((level.width-1)/stride), ny = Math.floor((level.height-1)/stride);
  const cx = meta.origin[0]+level.cellSizeM/2, cy = meta.origin[1]-level.cellSizeM/2;
  const mask = rasterizeLand(features,{width:nx,height:ny,originX:cx,originY:cy,resX:step,resY:-step});
  const cells = new Set();
  let land=[];
  for(const f of features) {
    let part=[];
    for(const ring of f.geometry.rings) {
      const r=ring.map(([x,y])=>[(x-cx)/step,(cy-y)/step]);
      part=clip.xor(part,[r]);
      for(let i=1;i<r.length;i++) {
        const [x,y]=r[i-1], dx=r[i][0]-x,dy=r[i][1]-y;
        const n=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))));
        for(let j=0;j<=n;j++) {
          const u=Math.floor(x+dx*j/n),v=Math.floor(y+dy*j/n);
          for(let a=Math.max(0,u-1);a<=Math.min(nx-1,u+1);a++)
            for(let b=Math.max(0,v-1);b<=Math.min(ny-1,v+1);b++) cells.add(b*nx+a);
        }
      }
    }
    land=clip.union(land,part);
  }
  const vertexLand=rasterizeLand(features,{width:nx+1,height:ny+1,originX:cx-step/2,originY:cy+step/2,resX:step,resY:-step});
  const hydro=reconcile({bytes:await fs.readFile(new URL(level.file,dir)),level,meta,nx,ny,cx,cy,step,stride,vertexLand,lines});
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(!mask[y*nx+x]&&hydro.candidate(x,y))cells.add(y*nx+x);
  const tiles=new Map(), cuts=[];
  for(const id of cells) {
    const x=id%nx,y=Math.floor(id/nx),tx=x-x%tile,ty=y-y%tile,key=ty*nx+tx;
    if(!tiles.has(key)) tiles.set(key,clip.intersection(land,[[[tx,ty],[tx+tile,ty],[tx+tile,ty+tile],[tx,ty+tile],[tx,ty]]]));
    const shapes=tiles.get(key);
    const faces=[]; let area=0;
    for(const [half,tri] of [[0,[[x,y],[x,y+1],[x+1,y]]],[1,[[x,y+1],[x+1,y+1],[x+1,y]]]]) {
      const original=clip.intersection(shapes,[tri]);
      const measured=hydro.footprint(tri);
      const coversTriangle=measured && tri.every(([x,y])=>measured[0].some(([u,v])=>x===u && y===v));
      const result=coversTriangle ? [[[...tri,tri[0]]]] : measured ? unionTriangle(original,measured) : original;
      for(const poly of result) {
        const xy=[],holes=[];
        for(const ring of poly) {
          if(xy.length) holes.push(xy.length/2);
          for(const [u,v] of ring.slice(0,-1)) xy.push(Math.round((u-x)*1e7)/1e7,Math.round((v-y)*1e7)/1e7);
        }
        const idx=earcut(xy,holes);
        for(let i=0;i<idx.length;i+=3) {
          const pts=idx.slice(i,i+3).map(k=>[xy[2*k],xy[2*k+1]]);
          const [[a,b],[c,d],[e,f]]=pts, det=(c-a)*(f-b)-(d-b)*(e-a);
          if(Math.abs(det)<1e-13) continue;
          if(det>0) [pts[1],pts[2]]=[pts[2],pts[1]];
          area+=Math.abs(det)/2;
          faces.push(half,...pts.flat());
        }
      }
    }
    if(area>1.0000001) throw Error("Área superpuesta en "+id);
    if (Math.abs(area-1)<1e-12) {mask[id]=1;continue;}
    if(!(mask[id] && Math.abs(area-1)<1e-12) && (mask[id] || faces.length)) cuts.push([id,faces]);
  }
  const runs = [];
  for(let y=0;y<ny;y++) for(let x=0;x<nx;) {
    if(!mask[y*nx+x]) { x++; continue; }
    const first=x++; while(x<nx && mask[y*nx+x]) x++;
    runs.push([y*nx+first,x-first]);
  }
  const out=gzipSync(JSON.stringify({nx,ny,runs,cuts}));
  await bake(dir,meta,level,out);
  console.log(level.name,cuts.length,"celdas",out.length,"bytes");
}


function unionTriangle(original, measured) {
  const scale=1e7;
  const paths=poly=>poly.map((ring,i)=>{
    const path=ring.map(([x,y])=>({X:Math.round(x*scale),Y:Math.round(y*scale)}));
    if(ClipperLib.Clipper.Orientation(path)!==(i===0))path.reverse();
    return path;
  });
  const c=new ClipperLib.Clipper();
  c.AddPaths(original.flatMap(paths),ClipperLib.PolyType.ptSubject,true);
  c.AddPaths(paths(measured),ClipperLib.PolyType.ptClip,true);
  const tree=new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.JS.PolyTreeToExPolygons(tree).map(p=>[p.outer,...p.holes].map(r=>{
    const ring=r.map(({X,Y})=>[X/scale,Y/scale]);ring.push(ring[0]);return ring;
  }));
}