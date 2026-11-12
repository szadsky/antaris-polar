const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function inlandDistance(sdf:Int8Array,w:number,h:number,cell:number){
 const d=Float32Array.from(sdf,v=>v<=0?0:1e9),diagonal=cell*Math.SQRT2;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x)d[i]=Math.min(d[i],d[i-1]+cell);if(y)d[i]=Math.min(d[i],d[i-w]+cell);if(x&&y)d[i]=Math.min(d[i],d[i-w-1]+diagonal);if(y&&x<w-1)d[i]=Math.min(d[i],d[i-w+1]+diagonal);}
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;if(x<w-1)d[i]=Math.min(d[i],d[i+1]+cell);if(y<h-1)d[i]=Math.min(d[i],d[i+w]+cell);if(x<w-1&&y<h-1)d[i]=Math.min(d[i],d[i+w+1]+diagonal);if(x&&y<h-1)d[i]=Math.min(d[i],d[i+w-1]+diagonal);}
 return d;
}
/** Artistic heightfield only. Source DEM is never written; coast/sea/crop borders stay fixed. */
export function artisticRelief(source:Float32Array,w:number,h:number,cell:number,sea:number,sdf:Int8Array|null){
 const delta=new Float32Array(source.length);if(!sdf)return delta;
 const distance=inlandDistance(sdf,w,h,cell);
 const temp=new Float32Array(source.length),soft=new Float32Array(source.length),stride=Math.max(1,Math.round(8/cell)),weights=[1,4,6,4,1];
 for(let pass=0;pass<2;pass++){const input=pass?temp:source,output=pass?soft:temp;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let sum=0,weight=0;for(let k=-2;k<=2;k++){const xx=Math.max(0,Math.min(w-1,x+(pass?0:k*stride))),yy=Math.max(0,Math.min(h-1,y+(pass?k*stride:0))),v=input[yy*w+xx];if(Number.isFinite(v)){sum+=v*weights[k+2];weight+=weights[k+2];}}output[y*w+x]=weight?sum/weight:NaN;}}
 const span=Math.max(2,Math.round(96/cell));
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const i=y*w+x,z=source[i],edge=Math.min(x,y,w-1-x,h-1-y)*cell;
  const mask=smooth(24,80,distance[i])*smooth(12,40,z-sea)*smooth(32,112,edge);
  if(!Number.isFinite(z)||mask===0)continue;
  const dx=(source[i+1]-source[i-1])/(2*cell),dy=(source[i+w]-source[i-w])/(2*cell),slope=Math.hypot(dx,dy);
  if(!Number.isFinite(slope))continue;
  const x0=Math.floor(x/span)*span,y0=Math.floor(y/span)*span,x1=Math.min(w-1,x0+span),y1=Math.min(h-1,y0+span),u=(x-x0)/(x1-x0),v=(y-y0)/(y1-y0);
  const a=soft[y0*w+x0],b=soft[y1*w+x0],c=soft[y0*w+x1],d=soft[y1*w+x1];
  if(![a,b,c,d,soft[i]].every(Number.isFinite))continue;
  const plane=u+v<=1?a*(1-u-v)+b*v+c*u:b*(1-u)+c*(1-v)+d*(u+v-1);
  const rock=smooth(.45,.95,slope),snow=soft[i]+(1-rock)*(2.5+Math.max(0,soft[i]-z)*.2);
  const target=snow*(1-rock*.9)+plane*rock*.9;
  delta[i]=mask*24*Math.tanh((target-z)/24);
 }
 return delta;
}
export function sampleReliefDelta(delta:Float32Array,w:number,h:number,x:number,y:number){
 x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));const ix=Math.floor(x),iy=Math.floor(y),jx=Math.min(w-1,ix+1),jy=Math.min(h-1,iy+1),u=x-ix,v=y-iy;
 return (delta[iy*w+ix]*(1-u)+delta[iy*w+jx]*u)*(1-v)+(delta[jy*w+ix]*(1-u)+delta[jy*w+jx]*u)*v;
}
