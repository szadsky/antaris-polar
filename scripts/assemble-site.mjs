import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,sep,relative} from 'node:path';
// Arma dist/ con los sitios ya compilados (ver scripts/build-site.mjs):
//   /                       hero (exploraciones/hero)
//   /descubrir/             visor de bases (exploraciones/terreno-estilizado, compilado con VISOR_BASE=/descubrir/)
//   /laboratorio/pinguino/  laboratorio del pingüino (exploraciones/penguin-lab)
//   /pinguino-menu/         islas de práctica (usa los recursos del laboratorio)
//   /antarisplay/           trivia «Rumbo a la Antártida» (exploraciones/trivia-antartida, estática)
//   /exploraciones/         índice de las versiones con controles: /exploraciones-home/, -bases/, -pinguino/, -islas/
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
// AntarisPlay: la trivia es estática (sin compilación); se copia tal cual, sin su README.
const trivia=join(root,'exploraciones/trivia-antartida');
await cp(trivia,join(out,'antarisplay'),{recursive:true,filter:src=>!/^README\.md$/.test(relative(trivia,src))});

// Exploraciones: la misma página de cada sección, con sus controles (compartido/modo.ts los muestra bajo
// /exploraciones…). Solo se copia el HTML: los recursos se piden por ruta absoluta a la ruta pública de cada sitio.
// El sitio público (/, /descubrir/, …) se ve sin controles.
const EXPLORACIONES=[
  {ruta:'exploraciones-home',html:join(out,'index.html'),titulo:'Home (hero)',texto:'Profundidad de las montañas por capa (Depth Anything V2), parallax y movimiento.'},
  {ruta:'exploraciones-bases',html:join(out,'descubrir/index.html'),titulo:'Bases',texto:'Visor de las 13 bases: sol y hora, exageración, calidad, material, agua, icebergs, edificios, efecto de píxeles y rendimiento.'},
  {ruta:'exploraciones-pinguino',html:join(lab,'index.html'),titulo:'Pingüino y nieve',texto:'Laboratorio del pingüino: huellas, deslizamiento, sonido y animación.'},
  {ruta:'exploraciones-islas',html:join(menu,'index.html'),titulo:'Islas de práctica',texto:'Las islas del pingüino con todos sus controles y el editor de estructuras.'},
];
for(const e of EXPLORACIONES){const d=join(out,e.ruta);await mkdir(d,{recursive:true});await writeFile(join(d,'index.html'),await readFile(e.html,'utf8'));}
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
await mkdir(join(out,'exploraciones'),{recursive:true});
await writeFile(join(out,'exploraciones/index.html'),`<!doctype html>
<html lang="es-AR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exploraciones · Antaris Polar</title><meta name="robots" content="noindex">
<style>
:root{color-scheme:light;--tinta:#232c45;--suave:#5b6683;--papel:#f4f7fb;--linea:#dfe4ee}
*{box-sizing:border-box}body{margin:0;background:var(--papel);color:var(--tinta);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:clamp(32px,8vw,72px) 16px}h1{margin:0 0 6px;font-size:clamp(26px,5vw,34px)}
p.lead{margin:0 0 28px;color:var(--suave)}ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
a.tarjeta{display:block;padding:18px 20px;border:1px solid var(--linea);border-radius:14px;background:#fff;color:inherit;text-decoration:none}
a.tarjeta:hover,a.tarjeta:focus-visible{border-color:#b9c3d8;box-shadow:0 2px 10px rgb(52 68 110/.08)}a.tarjeta:focus-visible{outline:2px solid var(--tinta);outline-offset:3px}
a.tarjeta strong{display:block;font-size:18px}a.tarjeta span{color:var(--suave);font-size:14px}code{font-size:13px}
.volver{display:inline-block;margin-top:28px;color:var(--tinta)}
</style></head><body><main>
<h1>Exploraciones</h1>
<p class="lead">Cada sección con sus parámetros editables. El sitio público (<a href="/">Antaris Polar</a>) muestra las mismas páginas sin controles.</p>
<ul>
${EXPLORACIONES.map(e=>`<li><a class="tarjeta" href="/${e.ruta}/"><strong>${esc(e.titulo)}</strong><span>${esc(e.texto)}</span><br><code>/${e.ruta}/</code></a></li>`).join('\n')}
</ul>
<a class="volver" href="/">← Volver al sitio</a>
</main></body></html>
`);
console.log('Site ready: dist/ — hero /, viewer /descubrir/, AntarisPlay /antarisplay/, laboratory /laboratorio/pinguino/, penguin menu /pinguino-menu/ and /exploraciones/ ('+EXPLORACIONES.map(e=>'/'+e.ruta+'/').join(', ')+')');
