import assert from 'node:assert/strict';
import {PenguinMotion,MOVE_SPEED,SLIDE,ICE,SNOW_GLIDE} from './src/penguin-motion.ts';
const flat=()=>[0,0],allIce=()=>1,steps=(m,s,dx,dz,run=false,slide=false)=>{for(let i=0;i<Math.round(s*60);i++)m.step(dx,dz,run,1/60,slide);};
// En hielo NO se tira de panza: patina de pie con inercia, más rápido que caminando en nieve.
const a=new PenguinMotion(Infinity,undefined,flat,allIce);steps(a,2.5,0,1);
assert(a.onIce&&a.skating&&!a.sliding,'On ice the penguin must skate upright, not belly-slide');
assert(Math.abs(a.slideSpeed-ICE.walkMax)<.06,`Ice walking speed ${a.slideSpeed.toFixed(2)}`);assert(ICE.walkMax>MOVE_SPEED.run);
// Con Shift, todavía más rápido; con E, de panza y lo más rápido.
const r=new PenguinMotion(Infinity,undefined,flat,allIce);steps(r,3,0,1,true);assert(r.running&&Math.abs(r.slideSpeed-ICE.runMax)<.06);
const b=new PenguinMotion(Infinity,undefined,flat,allIce);steps(b,3,0,1,false,true);assert(b.sliding&&!b.skating&&Math.abs(b.slideSpeed-ICE.bellyMax)<.06,'E on ice: belly slide');
// Al soltar sigue patinando de pie: frena solo por el rozamiento bajo.
const z0=a.z;steps(a,.5,0,0);assert(a.moving&&a.skating&&!a.pushing,'Must keep gliding upright after releasing the keys');
assert(Math.abs(a.slideSpeed-(ICE.walkMax-.5*ICE.friction))<.06);
// No se desliza de más: al soltar frena en menos de 1,5 s y menos de 2 m.
const glide=ICE.walkMax/ICE.friction,dist=ICE.walkMax*glide/2;assert(glide<1.5&&dist<2,`Glides ${glide.toFixed(1)} s / ${dist.toFixed(1)} m`);
steps(a,20,0,0);assert.equal(a.slideSpeed,0);assert.equal(a.moving,false,'Eventually stops');
// Poca tracción: el giro es gradual (ICE.turn rad/s como máximo).
const c=new PenguinMotion(Infinity,undefined,flat,allIce);steps(c,1,0,1);const yaw0=c.yaw;steps(c,.1,1,0);assert(Math.abs(c.yaw-yaw0)<=ICE.turn*.1+1e-9&&Math.abs(c.yaw-yaw0)>.2,'Turn must be gradual');
// En bajada acelera por encima del impulso, hasta el tope.
const d=new PenguinMotion(Infinity,undefined,()=>[0,-.4],allIce);steps(d,12,0,1);assert.equal(d.slideSpeed,SLIDE.max);
// Entra al hielo con la velocidad que traía; al salir sin E sigue patinando sobre la nieve y frena
// (sin detenerse en seco) hasta caminar.
const strip=(x,z)=>z>1&&z<9?1:0,e=new PenguinMotion(Infinity,undefined,flat,strip);steps(e,1.2,0,1,true);
assert(e.onIce&&e.slideSpeed>1.5,'Carries the run-in speed onto the ice');for(let i=0;i<600&&e.onIce;i++)e.step(0,1,false,1/60);e.step(0,1,false,1/60);
assert(!e.onIce&&e.carrying&&e.skating&&e.moving,'Keeps skating on the snow after the ice');const v=e.slideSpeed;steps(e,.2,0,0);assert(Math.abs(e.slideSpeed-(v-.2*SNOW_GLIDE))<.06,'Snow brakes the skid');
steps(e,3,0,1);assert(!e.carrying&&!e.skating&&!e.sliding,'Walks again on the snow');
// Choque de frente en hielo: se frena.
const f=new PenguinMotion(Infinity,(x,z)=>z<3,flat,allIce);steps(f,3,0,1);assert(f.z<3&&f.slideSpeed===0);
// Nieve sin cambios: sin E camina a la velocidad de siempre.
const g=new PenguinMotion(Infinity,undefined,flat,()=>0);steps(g,1,0,1);assert(!g.sliding&&!g.skating&&Math.abs(g.z-MOVE_SPEED.walk)<1e-9);
console.log(`PASS: hielo · patina de pie (no se tira) hasta ${ICE.walkMax} m/s, ${ICE.runMax} con Shift, ${ICE.bellyMax} de panza con E (nieve: ${MOVE_SPEED.walk}/${MOVE_SPEED.run}/${MOVE_SPEED.slide}) · al soltar planea ${(ICE.walkMax*ICE.walkMax/ICE.friction/2).toFixed(1)} m y frena · giro gradual · acelera en bajada hasta ${SLIDE.max} · al salir frena patinando sobre la nieve · frena al chocar.`);
