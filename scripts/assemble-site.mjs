import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,sep} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(root,'dist');
if(out!==join(root,'dist')||!out.startsWith(resolve(root)+sep))throw Error('Invalid output directory');
// Only the explicit generated site output is replaced; source projects are untouched.
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await cp(join(root,'exploraciones/terreno-estilizado/dist'),out,{recursive:true});
const lab=join(out,'laboratorio/pinguino');await mkdir(lab,{recursive:true});
await cp(join(root,'exploraciones/penguin-lab/dist'),lab,{recursive:true});
const index=join(out,'index.html');let html=await readFile(index,'utf8');
if(!html.includes('</aside>'))throw Error('Viewer navigation anchor missing');
html=html.replace('</aside>','<p class="hud__help"><a href="/laboratorio/pinguino/">Laboratorio · Pingüino y nieve</a></p></aside>');
await writeFile(index,html);
const labHtml=await readFile(join(lab,'index.html'),'utf8');
if(!labHtml.includes('/laboratorio/pinguino/assets/'))throw Error('Laboratory assets must use their own route');
console.log('Site ready: dist/ — viewer / and laboratory /laboratorio/pinguino/');
