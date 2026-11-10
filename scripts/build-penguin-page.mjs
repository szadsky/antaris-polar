import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
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
const index = join(out, 'index.html');
let html = await readFile(index, 'utf8');
if (!html.includes('/laboratorio/pinguino/')) {
  if (!html.includes('</aside>')) throw Error('Viewer navigation anchor missing');
  html = html.replace('</aside>', '<p class="hud__help"><a href="/laboratorio/pinguino/">Laboratorio · Pingüino y nieve</a></p></aside>');
  await writeFile(index, html);
}
console.log('Penguin laboratory included in viewer deployment.');
