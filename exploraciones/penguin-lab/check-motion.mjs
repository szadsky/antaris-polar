import assert from 'node:assert/strict';
import {PenguinMotion,MOVE_SPEED} from './src/penguin-motion.ts';
for(const fps of [30,60,120]){const m=new PenguinMotion(50);for(let i=0;i<fps;i++)m.step(1,1,false,1/fps);assert(Math.abs(Math.hypot(m.x,m.z)-MOVE_SPEED.walk)<1e-9);}
const m=new PenguinMotion(2.3);for(let i=0;i<600;i++)m.step(1,0,true,1/60);assert(Math.hypot(m.x,m.z)<=2.3);m.step(0,0,false,1/60);assert.equal(m.moving,false);m.jump();let peak=0;for(let i=0;i<120;i++){m.step(0,0,false,1/60);peak=Math.max(peak,m.y);}assert(peak>.3&&peak<.4);assert.equal(m.y,0);m.reset();assert.equal(m.x,0);console.log('PASS: velocidad independiente de FPS, diagonales, borde, frenado, salto y reinicio.');
