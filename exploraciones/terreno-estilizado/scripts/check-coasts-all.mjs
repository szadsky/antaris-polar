import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const root='../terreno-nitidez/public/terreno/';
for(const {id} of JSON.parse(fs.readFileSync(root+'index.json')).bases){const meta=JSON.parse(fs.readFileSync(root+id+'/terreno.json'));for(const l of meta.levels){const r=spawnSync(process.execPath,['scripts/check-coast-alignment.mjs',id,l.name],{encoding:'utf8'});process.stdout.write(r.stdout);if(r.status!==0){process.stderr.write(r.stderr);process.exit(r.status||1);}}}
