import assert from 'node:assert/strict';
import {SnowParticles} from './src/snow-particles.ts';
const p=new SnowParticles(64),pos=p.points.geometry.getAttribute('position').array,alpha=p.points.geometry.getAttribute('alpha').array;
// Una pisada: los granitos suben, frenan en el aire y caen; ninguno queda vivo después de su vida (≤ 0,85 s).
p.emit(0,0,0,10,{dirX:0,dirZ:1});p.update(1/60);assert.equal(p.alive,10);
let top=0;for(let f=0;f<20;f++){p.update(1/60);for(let i=0;i<10;i++)top=Math.max(top,pos[i*3+1]);}
assert(top>.05&&top<.5,`Snow puff height ${top.toFixed(2)} m`);
// Hacia atrás del movimiento (+z): la nieve sale mayormente hacia −z.
let back=0;for(let i=0;i<10;i++)if(pos[i*3+2]<0)back++;assert(back>=6,'Snow must be thrown backwards');
for(let f=0;f<60;f++)p.update(1/60);assert.equal(p.alive,0);for(let i=0;i<64;i++)assert.equal(alpha[i],0);
// Búfer circular: más emisiones que capacidad no rompe nada y no pasa de la capacidad.
for(let k=0;k<20;k++)p.emit(1,0,1,10);p.update(1/60);assert(p.alive<=64);for(const v of pos)assert(Number.isFinite(v));
// Al tocar el suelo se apagan enseguida (suelo a 0,1 m: nada debajo después de caer).
const q=new SnowParticles(16);q.emit(0,.1,0,16,{up:[.2,.3]});for(let f=0;f<20;f++)q.update(1/60,()=>.1);assert.equal(q.alive,0,'Particles must die on the ground');
console.log('PASS: partículas de nieve · saltan ~'+(top*100).toFixed(0)+' cm, hacia atrás del paso, se apagan al tocar el suelo o al terminar su vida, búfer circular sin desbordes.');
