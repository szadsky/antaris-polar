import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=new URL('../../terreno-nitidez/public/terreno/',import.meta.url);
const available=JSON.parse(await fs.readFile(new URL('index.json',root))).bases.map(b=>b.id);
const ids=process.argv.length>2 ? process.argv.slice(2) : available;
if(ids.some(id=>!available.includes(id)))throw Error('Base inválida');
const backup=await fs.mkdtemp(path.join(os.tmpdir(),'antaris-before-vector-all-'));console.log('Respaldo:',backup);
for(const id of ids){await fs.mkdir(path.join(backup,id));for(const name of await fs.readdir(new URL(id+'/',root)))if(/^(malla-|costa-vector-)/.test(name))await fs.copyFile(new URL(id+'/'+name,root),path.join(backup,id,name));}
for(const id of ids){console.log('Procesando superficie REMA:',id);const r=spawnSync(process.execPath,['scripts/rehornear-brown.mjs',id],{stdio:'inherit'});if(r.status!==0)throw Error('Falló '+id+'; respaldo '+backup);}
