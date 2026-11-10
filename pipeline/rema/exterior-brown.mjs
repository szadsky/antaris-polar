import {fromUrl} from './node_modules/geotiff/dist-module/geotiff.js';
import fs from 'node:fs';
const meta=JSON.parse(fs.readFileSync('../../data/rema/brown_2m.json'));
const tif=await fromUrl(meta.access.tiles_used[0].dem_cog);
const img=await tif.getImage(4), ref=await tif.getImage();
const [sx,sy]=img.getResolution(ref),[ox,oy]=ref.getOrigin();
const [cx,cy]=[-2465602,1263318];
const px=x=>Math.round((cx+x-ox)/sx-.5), py=z=>Math.round((cy-z-oy)/sy-.5);
const x0=px(-6000),y0=py(-6000),x1=px(6000)+1,y1=py(6000)+1;
const [h]=await img.readRasters({window:[x0,y0,x1,y1]});
const out=new Int16Array(201*201);
for(let j=0;j<=200;j++) for(let i=0;i<=200;i++){
 const v=h[(py(j*60-6000)-y0)*(x1-x0)+px(i*60-6000)-x0];
 out[j*201+i]=Number.isFinite(v)&&v!==img.getGDALNoData()&&v>-9990?Math.round(v*10):-32768;
}
fs.writeFileSync('../../exploraciones/terreno-nitidez/public/terreno/brown/exterior-60m.bin',Buffer.from(out.buffer));
console.log(sx,out.length);
