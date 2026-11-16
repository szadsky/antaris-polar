// Inspecciona las capas del zip: tamaño, cobertura de alfa y bbox opaco.
import sharp from 'sharp';
import {readdirSync} from 'node:fs';
const dir=process.argv[2];
for(const f of readdirSync(dir).filter(f=>f.endsWith('.png')).sort()){
  const {data,info}=await sharp(`${dir}/${f}`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const {width:w,height:h}=info;let x0=w,y0=h,x1=-1,y1=-1,n=0,semi=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const a=data[(y*w+x)*4+3];if(a>8){n++;if(a<247)semi++;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}}
  console.log(f,w+'x'+h,'opaco',(100*n/(w*h)).toFixed(1)+'%','semi',(100*semi/(w*h)).toFixed(1)+'%','bbox',[x0,y0,x1,y1].join(','));
}
