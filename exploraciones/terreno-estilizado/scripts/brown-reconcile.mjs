// Match the REMA triangle lattice. Extend only where sampled relief is connected
// to ADD land and the official line identifies a rock or grounded-ice coastline.
import {gunzipSync} from "node:zlib";
export function reconcile({bytes,level,meta,nx,ny,cx,cy,step,stride,vertexLand,lines}) {
  const raw=gunzipSync(bytes), size=level.width*level.height, q=new Uint16Array(size);
  for(let i=0;i<size;i++) q[i]=((raw[i]<<8)|raw[size+i])+(i%level.width?q[i-1]:i>=level.width?q[i-level.width]:0);
  const w=nx+1,h=ny+1;
  const z=new Float32Array(w*h);
  const water=meta.geoid.egm2008;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const v=q[y*stride*level.width+x*stride];
    z[y*w+x]=v ? meta.heights.minM+(v-1)*meta.heights.stepM-water : NaN;
  }
  // Four-cell coastal search neighbourhood on the source map, up to 256 m.
  // Grounding lines and floating shelf fronts are never used as land anchors.
  const near=new Uint8Array(w*h),radius=256/step;
  for(const f of lines.features) {
    if(!["rock coastline","ice coastline"].includes(f.attributes.surface)) continue;
    for(const path of f.geometry.paths) for(let i=1;i<path.length;i++){
      const [ax,ay]=[(path[i-1][0]-cx)/step,(cy-path[i-1][1])/step];
      const [bx,by]=[(path[i][0]-cx)/step,(cy-path[i][1])/step];
      const dx=bx-ax,dy=by-ay,d=dx*dx+dy*dy;
      for(let y=Math.max(0,Math.floor(Math.min(ay,by)-radius));y<=Math.min(ny,Math.ceil(Math.max(ay,by)+radius));y++)
        for(let x=Math.max(0,Math.floor(Math.min(ax,bx)-radius));x<=Math.min(nx,Math.ceil(Math.max(ax,bx)+radius));x++){
          const t=d?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/d)):0;
          if((x-ax-t*dx)**2+(y-ay-t*dy)**2<=radius*radius)near[y*w+x]=1;
        }
    }
  }
  const seen=new Uint8Array(z.length),queue=new Int32Array(z.length);
  let head=0,tail=0;
  function visit(i){
    // Half a metre below mean sea level covers quantisation and the existing
    // display dequantisation. The independent ocean covers that submerged edge.
    if(!seen[i] && near[i] && z[i]>-0.5){seen[i]=1;queue[tail++]=i;}
  }
  for(let i=0;i<z.length;i++) if(vertexLand[i])visit(i);
  while(head<tail){
    const i=queue[head++],x=i%w;
    if(x)visit(i-1); if(x<nx)visit(i+1);
    if(i>=w){visit(i-w);if(x<nx)visit(i-w+1);}
    if(i+w<z.length){visit(i+w);if(x)visit(i+w-1);}
  }
  return {
    candidate(x,y){const i=y*w+x;return seen[i]||seen[i+1]||seen[i+w]||seen[i+w+1];},
    footprint(tri){
      const ids=tri.map(([x,y])=>y*w+x);
      if(!ids.some(i=>seen[i]) || ids.some(i=>!Number.isFinite(z[i]) || (z[i]>-0.5 && !seen[i])))return null;
      const ring=[];
      for(let j=0;j<3;j++){
        const k=(j+2)%3,a=z[ids[k]]+0.5,b=z[ids[j]]+0.5;
        if((a>0)!==(b>0)){
          const t=a/(a-b);
          ring.push(tri[k].map((v,n)=>v+(tri[j][n]-v)*t));
        }
        if(b>0)ring.push(tri[j]);
      }
      return ring.length>=3?[ring]:null;
    }
  };
}

