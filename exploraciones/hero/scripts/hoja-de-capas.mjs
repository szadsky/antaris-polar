// Hoja de contacto de capas sobre fondo magenta (para revisar alfa).
import sharp from 'sharp';
import {readdirSync} from 'node:fs';
const [dir,out]=process.argv.slice(2);const W=600,H=338;
const files=readdirSync(dir).filter(f=>f.endsWith('.png')).sort();
const comps=await Promise.all(files.map(async(f,i)=>({input:await sharp({create:{width:W,height:H,channels:4,background:'#ff00ff'}}).composite([{input:await sharp(`${dir}/${f}`).resize(W,H).toBuffer()}]).png().toBuffer(),left:(i%2)*W,top:Math.floor(i/2)*H})));
await sharp({create:{width:W*2,height:H*Math.ceil(files.length/2),channels:4,background:'#000'}}).composite(comps).png().toFile(out);
