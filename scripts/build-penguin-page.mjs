import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const lab = join(root, 'exploraciones/penguin-lab');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = args => execFileSync(npm, args, { cwd: lab, stdio: 'inherit', shell: process.platform === 'win32' });
try { await access(join(lab, 'node_modules/typescript/package.json')); }
catch { run(['ci', '--include=dev']); }
run(['run', 'build']);
const out = join(root, 'exploraciones/terreno-estilizado/dist');
const dest = join(out, 'laboratorio/pinguino');
await mkdir(dest, { recursive: true });
await cp(join(lab, 'dist'), dest, { recursive: true });
// Pingüino · menú (islas de práctica): su HTML va a /pinguino-menu/ y usa los recursos del laboratorio
// por ruta absoluta (/laboratorio/pinguino/assets/).
const menuHtml = await readFile(join(lab, 'dist/pinguino-menu/index.html'), 'utf8');
if (!menuHtml.includes('/laboratorio/pinguino/assets/')) throw Error('Penguin menu assets must use the laboratory route');
await mkdir(join(out, 'pinguino-menu'), { recursive: true });
await writeFile(join(out, 'pinguino-menu/index.html'), menuHtml);
await rm(join(dest, 'pinguino-menu'), { recursive: true, force: true });
// Los enlaces entre visor, laboratorio y menú los da la navegación común (compartido/navbar).
console.log('Penguin laboratory (/laboratorio/pinguino/) and penguin menu (/pinguino-menu/) included in viewer deployment.');
