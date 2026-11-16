// Caída: el pingüino baja por laderas demasiado empinadas para caminar y cae de los bordes en vez de quedar trabado.
// node --experimental-transform-types check-fall.mjs
import { PenguinMotion } from './src/penguin-motion.ts';

const assert = (ok, msg) => { if (!ok) { console.error('FAIL: ' + msg); process.exit(1); } };
const MAX = Math.tan((34 * Math.PI) / 180);
// Meseta de 3 m (x < 0), acantilado de ~70° (0 ≤ x < 1,1) y llano a 0 m; agua más allá de x = 8.
const height = (x) => (x < 0 ? 3 : x < 1.1 ? 3 - (x / 1.1) * 3 : 0);
const slope = (x) => Math.abs(height(x + 0.08) - height(x - 0.08)) / 0.16;
const land = (x, z) => x < 8 && Math.abs(z) < 10;
const canStand = (x, z) => land(x, z) && slope(x) <= MAX;
const run = (withFall, dir = 1, start = -1, seconds = 5) => {
  const m = new PenguinMotion(Infinity, canStand);
  if (withFall) m.fall = { height: (x) => height(x), canLand: land };
  m.setHome(start, 0);
  let maxY = 0, airborne = 0;
  for (let i = 0; i < seconds * 60; i++) { m.step(dir, 0, false, 1 / 60); maxY = Math.max(maxY, m.y); if (m.y > 0) airborne++; }
  return { x: m.x, y: m.y, maxY, airborne };
};
const stuck = run(false), fell = run(true);
assert(stuck.x < 0.1, `sin caída se queda arriba del borde (x ${stuck.x.toFixed(2)})`);
assert(fell.x > 1.5 && fell.y === 0, `con caída baja y aterriza abajo (x ${fell.x.toFixed(2)}, y ${fell.y.toFixed(2)})`);
assert(fell.maxY > 0.15 && fell.airborne > 5, `cae por el aire desde el borde (altura máx. sobre el suelo ${fell.maxY.toFixed(2)} m)`);
// No sube el acantilado: desde abajo, caminando hacia la meseta, queda al pie.
const up = run(true, -1, 3, 5);
assert(up.x > 1.0, `no trepa la pared (x ${up.x.toFixed(2)})`);
// No cae al agua.
const sea = run(true, 1, 6, 5);
assert(sea.x < 8, `no entra al agua (x ${sea.x.toFixed(2)})`);
console.log(`PASS: caída · sin caída queda trabado arriba (x ${stuck.x.toFixed(2)}) · con caída cae ${fell.maxY.toFixed(2)} m por el aire y sigue abajo (x ${fell.x.toFixed(2)}) · no trepa paredes · no entra al agua.`);
