// Compila los sitios y arma dist/ (npm run build en la raíz):
//   hero → «/», visor → «/descubrir/» (VISOR_BASE), laboratorio y menú del pingüino (postbuild del visor).
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const win = process.platform === 'win32';
const run = (args, env = {}) =>
  execFileSync(win ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit', shell: win, env: { ...process.env, ...env } });

run(['--prefix', 'exploraciones/hero', 'run', 'build']);
run(['--prefix', 'exploraciones/terreno-estilizado', 'run', 'build'], { VISOR_BASE: '/descubrir/' });
await import('./assemble-site.mjs');
