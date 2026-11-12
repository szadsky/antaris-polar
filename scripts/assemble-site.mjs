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
if(!html.includes('/laboratorio/pinguino/'))html=html.replace('</aside>','<p class="hud__help"><a href="/laboratorio/pinguino/">Laboratorio · Pingüino y nieve</a></p></aside>');
if(!html.includes('/pinguino-menu/'))html=html.replace('</aside>','<p class="hud__help"><a href="/pinguino-menu/">Pingüino · menú (islas de práctica)</a></p></aside>');
await writeFile(index,html);
const labHtml=await readFile(join(lab,'index.html'),'utf8');
if(!labHtml.includes('/laboratorio/pinguino/assets/'))throw Error('Laboratory assets must use their own route');
// Pingüino · menú: su HTML se publica en /pinguino-menu/ y usa los recursos del laboratorio por ruta absoluta.
const menu=join(out,'pinguino-menu');await mkdir(menu,{recursive:true});
await rm(join(lab,'pinguino-menu'),{recursive:true,force:true});
const menuHtml=await readFile(join(root,'exploraciones/penguin-lab/dist/pinguino-menu/index.html'),'utf8');
if(!menuHtml.includes('/laboratorio/pinguino/assets/'))throw Error('Penguin menu assets must use the laboratory route');
await writeFile(join(menu,'index.html'),menuHtml);
console.log('Site ready: dist/ — viewer /, laboratory /laboratorio/pinguino/ and penguin menu /pinguino-menu/');
