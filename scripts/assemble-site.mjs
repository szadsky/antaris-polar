import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,sep,relative} from 'node:path';
// Arma dist/ con los sitios ya compilados (ver scripts/build-site.mjs):
//   /                       hero (exploraciones/hero)
//   /descubrir/             visor de bases (exploraciones/terreno-estilizado, compilado con VISOR_BASE=/descubrir/)
//   /laboratorio/pinguino/  laboratorio del pingüino (exploraciones/penguin-lab)
//   /pinguino-menu/         islas de práctica (usa los recursos del laboratorio)
// Todos llevan la misma navegación (compartido/navbar), incluida en el código de cada sitio.
const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(root,'dist');
if(out!==join(root,'dist')||!out.startsWith(resolve(root)+sep))throw Error('Invalid output directory');
// Only the explicit generated site output is replaced; source projects are untouched.
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});

const hero=join(root,'exploraciones/hero/dist');
await cp(hero,out,{recursive:true});

const visor=join(root,'exploraciones/terreno-estilizado/dist');
const visorHtml=await readFile(join(visor,'index.html'),'utf8');
if(!visorHtml.includes('/descubrir/assets/'))throw Error('Viewer must be built with VISOR_BASE=/descubrir/ (npm run build)');
// El postbuild del visor también copia el laboratorio y el menú dentro de su dist: acá van en sus propias rutas.
await cp(visor,join(out,'descubrir'),{recursive:true,filter:src=>!/^(laboratorio|pinguino-menu)([\\/]|$)/.test(relative(visor,src))});

const lab=join(out,'laboratorio/pinguino');await mkdir(lab,{recursive:true});
await cp(join(root,'exploraciones/penguin-lab/dist'),lab,{recursive:true});
const labHtml=await readFile(join(lab,'index.html'),'utf8');
if(!labHtml.includes('/laboratorio/pinguino/assets/'))throw Error('Laboratory assets must use their own route');
// Pingüino · menú: su HTML se publica en /pinguino-menu/ y usa los recursos del laboratorio por ruta absoluta.
const menu=join(out,'pinguino-menu');await mkdir(menu,{recursive:true});
await rm(join(lab,'pinguino-menu'),{recursive:true,force:true});
const menuHtml=await readFile(join(root,'exploraciones/penguin-lab/dist/pinguino-menu/index.html'),'utf8');
if(!menuHtml.includes('/laboratorio/pinguino/assets/'))throw Error('Penguin menu assets must use the laboratory route');
await writeFile(join(menu,'index.html'),menuHtml);
console.log('Site ready: dist/ — hero /, viewer /descubrir/, laboratory /laboratorio/pinguino/ and penguin menu /pinguino-menu/');
