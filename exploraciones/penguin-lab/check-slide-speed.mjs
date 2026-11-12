import assert from 'node:assert/strict';
import {PenguinMotion,MOVE_SPEED,SLIDE} from './src/penguin-motion.ts';
// Rampa: baja hacia +z con pendiente 0,4 (dh/dz = −0,4). Plano: gradiente 0.
const ramp=()=>[0,-.4],flat=()=>[0,0],up=()=>[0,.4];
const slideFor=(m,seconds,fps=60)=>{for(let i=0;i<Math.round(seconds*fps);i++)m.step(0,1,false,1/fps,true);return m.slideSpeed;};
// En plano: velocidad base constante.
const a=new PenguinMotion(Infinity,undefined,flat);slideFor(a,2);assert(Math.abs(a.slideSpeed-MOVE_SPEED.slide)<1e-9,'Flat slide must keep the base speed');
// En bajada: acelera (6 × 0,4 − 0,6 = 1,8 m/s²) y llega al tope.
const b=new PenguinMotion(Infinity,undefined,ramp);slideFor(b,1);assert(Math.abs(b.slideSpeed-(MOVE_SPEED.slide+1.8))<.02,`Downhill: ${b.slideSpeed.toFixed(2)} m/s after 1 s`);
slideFor(b,10);assert.equal(b.slideSpeed,SLIDE.max,'Speed must cap at the maximum');
// Del tobogán al plano: frena con el rozamiento hasta la base.
b.gradient=flat;slideFor(b,2);assert(Math.abs(b.slideSpeed-(SLIDE.max-2*SLIDE.friction))<.02,'Flat after the ramp must decelerate by friction');
slideFor(b,20);assert.equal(b.slideSpeed,MOVE_SPEED.slide);
// En subida nunca baja de la base; al soltar E vuelve a la base.
const c=new PenguinMotion(Infinity,undefined,ramp);slideFor(c,2);c.gradient=up;slideFor(c,5);assert.equal(c.slideSpeed,MOVE_SPEED.slide);
slideFor(c,0);const d=new PenguinMotion(Infinity,undefined,ramp);slideFor(d,2);d.step(0,1,false,1/60,false);assert.equal(d.slideSpeed,MOVE_SPEED.slide,'Releasing E resets the slide speed');
// Independiente de los FPS: distancia recorrida en 2 s de bajada a 30, 60 y 120 FPS (±2 %).
const dist=fps=>{const m=new PenguinMotion(Infinity,undefined,ramp);slideFor(m,2,fps);return m.z;};
const d30=dist(30),d60=dist(60),d120=dist(120);assert(Math.abs(d30-d120)/d120<.02&&Math.abs(d60-d120)/d120<.02,`FPS dependent: ${d30.toFixed(2)} / ${d60.toFixed(2)} / ${d120.toFixed(2)} m`);
// A velocidad máxima no atraviesa una pared fina (subpasos de 12 cm).
const wall=new PenguinMotion(Infinity,(x,z)=>!(z>3&&z<3.2),ramp);wall.slideSpeed=SLIDE.max;slideFor(wall,1,20);assert(wall.z<=3,'Fast slide went through a thin wall');assert.equal(wall.slideSpeed,MOVE_SPEED.slide,'Head-on crash loses the momentum');
// Choque rasante (22°) contra una pared lateral: sigue deslizando a lo largo de la pared, no frena en seco.
const graze=new PenguinMotion(Infinity,(x)=>x<1,ramp);graze.x=.9;const gx=Math.sin(22*Math.PI/180),gz=Math.cos(22*Math.PI/180);
for(let i=0;i<120;i++)graze.step(gx,gz,false,1/60,true);assert(graze.z>3&&graze.x<1,`Grazing slide stopped at z=${graze.z.toFixed(2)}`);
// Caminar y correr más rápido que antes (0,48 y 1,1 m/s).
assert(MOVE_SPEED.walk>=.8&&MOVE_SPEED.run>=1.8&&MOVE_SPEED.slide>=2.5);
console.log(`PASS: deslizamiento acelera en bajada (${(MOVE_SPEED.slide+1.8).toFixed(1)} m/s al segundo, tope ${SLIDE.max}), frena en plano y subida, no depende de los FPS y no atraviesa paredes; caminar ${MOVE_SPEED.walk}, correr ${MOVE_SPEED.run}, deslizar ${MOVE_SPEED.slide} m/s.`);
