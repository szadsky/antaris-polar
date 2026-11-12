import fs from 'node:fs';import proj4 from 'proj4';import {fromUrl} from '../../terreno-nitidez/node_modules/geotiff/dist-module/geotiff.js';
const ids=process.argv.slice(2).length?process.argv.slice(2):['S2B_20DNP_20240818_0_L2A','S2B_20DNP_20250323_0_L2A'];
const items=await Promise.all(ids.map(async id=>{const r=await fetch('https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/'+encodeURIComponent(id));if(!r.ok)throw Error('STAC '+r.status);return r.json();}));
const meta=JSON.parse(fs.readFileSync('../terreno-nitidez/public/terreno/brown/terreno.json'));
proj4.defs('EPSG:3031','+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:32720','+proj=utm +zone=20 +south +datum=WGS84 +units=m +no_defs');
const N=512,pixels=Array.from({length:N*N},(_,i)=>proj4('EPSG:3031','EPSG:32720',[meta.origin[0]+(i%N+.5)*8000/N,meta.origin[1]-(Math.floor(i/N)+.5)*8000/N]));
fs.mkdirSync('reports/seasonal-brown',{recursive:true});
for(const id of ids){
 const item=items.find(i=>i.id===id);let summary={id,properties:item.properties};
 for(const key of ['scl','green','swir16']){
  const asset=item.assets[key];const t=await fromUrl(asset.href);const image=await t.getImage();const origin=image.getOrigin(),res=image.getResolution();
  const coords=pixels.map(([x,y])=>[Math.floor((x-origin[0])/res[0]),Math.floor((y-origin[1])/res[1])]);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const[x,y]of coords){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}x0=Math.max(0,x0);y0=Math.max(0,y0);x1=Math.min(image.getWidth(),x1);y1=Math.min(image.getHeight(),y1);
  const a=await image.readRasters({window:[x0,y0,x1,y1],samples:[0],interleave:true});const out=new Uint16Array(N*N);const counts={};for(let i=0;i<coords.length;i++){const[x,y]=coords[i];out[i]=x>=x0&&x<x1&&y>=y0&&y<y1?a[(y-y0)*(x1-x0)+x-x0]:0;if(key==='scl')counts[out[i]]=(counts[out[i]]??0)+1;}
  fs.writeFileSync('reports/seasonal-brown/'+id+'-'+key+'.bin',Buffer.from(out.buffer));summary[key]={href:asset.href,band:asset['raster:bands'],counts};console.log(id,key,key==='scl'?counts:{window:[x0,y0,x1,y1]});
 }
 fs.writeFileSync('reports/seasonal-brown/'+id+'.json',JSON.stringify(summary,null,2));
}
