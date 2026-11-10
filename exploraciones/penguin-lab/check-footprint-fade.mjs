import assert from 'node:assert/strict';import {SnowFootprints} from './src/snow-footprints.ts';
const f=new SnowFootprints(2.7);f.stamp(0,0,0);const full=f.sample(0,0);f.fade(8);assert.equal(f.sample(0,0),full);f.fade(3);assert(Math.abs(f.sample(0,0)/full-.5)<1e-5);f.fade(3);assert.equal(f.sample(0,0),0);assert.equal(f.active.size,0);assert.equal(f.fade(1),null);
f.stamp(0,0,0);f.fade(10);f.stamp(0,0,0);const refreshed=f.sample(0,0);f.fade(7);assert.equal(f.sample(0,0),refreshed);f.clear();assert.equal(f.active.size,0);
console.log('PASS: 8 segundos estable, desaparición suave durante 6 segundos, reposo sin trabajo y renovación al pisar.');
