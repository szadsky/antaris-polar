import fs from 'node:fs';import {gunzipSync,gzipSync} from 'node:zlib';
const dir='../terreno-nitidez/public/terreno/brown/',N=512;
const raw=gunzipSync(fs.readFileSync(dir+'costa-8m.sdf.gz')),sdf=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)sdf[i]=((i%1000?sdf[i-1]:i>=1000?sdf[i-1000]:0)+raw[i])&255;
const masks=[],entries=[];
for(const id of ['S2B_20DNP_20240818_0_L2A','S2B_20DNP_20250323_0_L2A']){
 const prefix='reports/seasonal-brown/'+id;const item=JSON.parse(fs.readFileSync(prefix+'.json'));
 const load=key=>{const b=fs.readFileSync(prefix+'-'+key+'.bin');return new Uint16Array(b.buffer,b.byteOffset,b.byteLength/2);};const scl=load('scl'),g=load('green'),sw=load('swir16'),out=new Uint8Array(N*N*2);
 const reflectance=(key,value)=>{const band=item[key].band[0];return value*band.scale+(item.properties['earthsearch:boa_offset_applied']?0:band.offset??0);};
 let land=0,snow=0,rock=0;
 for(let i=0;i<N*N;i++){const col=Math.min(999,Math.floor((i%N+.5)*1000/N)),row=Math.min(999,Math.floor((Math.floor(i/N)+.5)*1000/N));if(sdf[row*1000+col]<=136)continue;land++;if(!g[i]||!sw[i])continue;const green=reflectance('green',g[i]),swir=reflectance('swir16',sw[i]);if(green<=.03||swir<0||green+swir<.02)continue;const ndsi=(green-swir)/(green+swir);if(scl[i]===11&&ndsi>.4){out[i*2]=255;out[i*2+1]=255;snow++;}else if(scl[i]===5&&ndsi<.2){out[i*2+1]=255;rock++;}}
 const date=id.slice(10,18).replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3'),file='snow-'+date+'.rg.gz',gz=gzipSync(out);
 fs.writeFileSync(dir+file,gz);const entry={id,date,file,width:N,height:N,format:'RG8: snow-times-validity, validity',crs:'EPSG:3031',bounds:[-2469602,1259318,-2461602,1267318],observedLandFraction:(snow+rock)/land,snowPixels:snow,rockPixels:rock,landPixels:land,downloadBytes:gz.length,source:item.scl.href,method:'SCL 11 + NDSI > 0.4; SCL 5 + NDSI < 0.2. Clouds, shadows, water and uncertain pixels retain the original material. Nearest source sampling; 20 m SWIR/SCL information. Not snow depth.'};entries.push(entry);masks.push(out);console.log(entry.date,{snow,rock,land,valid:(snow+rock)/land,bytes:gz.length});
}
let common=0,changed=0;for(let i=0;i<N*N;i++)if(masks[0][i*2+1]&&masks[1][i*2+1]){common++;if(masks[0][i*2]!==masks[1][i*2])changed++;}
const manifest={title:'Cobertura observada · prueba Brown',warning:'Clasificación automática de nieve/hielo y roca; no mide espesor. Dos observaciones, no un modelo estacional.',commonPixels:common,changedPixels:changed,entries};fs.writeFileSync(dir+'snow-observations.json',JSON.stringify(manifest,null,2));console.log({common,changed});
