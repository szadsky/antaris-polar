// Pingüino del hero: el GLB del laboratorio (penguin-custom-smooth.glb, Polyfork, CC BY 4.0) solo con la animación
// «Idle» (el hero no camina ni corre), con claves y vértices duplicados eliminados. Sin cuantizar ni comprimir geometría: los colores de vértice que lee
// king-penguin-colors.ts quedan idénticos.  node scripts/pinguino-hero.mjs
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { prune, resample, weld, dedup } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const SRC = '../penguin-lab/public/assets/models/penguin-custom-smooth.glb', OUT = 'public/assets/models/pinguino-hero.glb';
// atributos separados: king-penguin-colors.ts clona el color de vértice (con atributos intercalados, three avisa y los separa)
const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(SRC);
for (const a of doc.getRoot().listAnimations()) if (a.getName().toLowerCase() !== 'idle') a.dispose();
// resample: quita claves de animación redundantes (interpolación lineal, tolerancia 1e-4) · weld: une vértices
// idénticos (la malla venía sin índices) · dedup + prune: sin datos repetidos ni huérfanos.
await doc.transform(resample({ tolerance: 1e-4 }), weld(), dedup(), prune());
await io.write(OUT, doc);
console.log({ origen: statSync(SRC).size, salida: statSync(OUT).size, animaciones: doc.getRoot().listAnimations().map((a) => a.getName()) });
