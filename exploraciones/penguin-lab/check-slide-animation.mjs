import {AnimationMixer} from 'three';
import fs from 'node:fs';import assert from 'node:assert/strict';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {groundedSlideClip,slideSupportWeight} from './src/slide-animation.ts';
const b=fs.readFileSync('public/assets/models/penguin-custom-smooth.glb');const g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');const source=g.animations.find(c=>c.name==='Swim'),original=source.tracks.map(t=>Array.from(t.values)),slide=groundedSlideClip(source);let checked=0,moving=0;
for(let i=0;i<slide.tracks.length;i++){const t=slide.tracks[i];assert.deepEqual(Array.from(source.tracks[i].values),original[i]);if(/^(Hips|Spine|Chest)\./.test(t.name)){const n=t.getValueSize();for(let j=n;j<t.values.length;j++)assert.equal(t.values[j],t.values[j%n]);checked++;}else {assert.deepEqual(Array.from(t.values),original[i]);if(/Wing/.test(t.name)&&new Set(t.values).size>4)moving++;}}
assert(checked>=3);assert(moving>0);console.log('PASS: cuerpo estable, aletas animadas y clip original intacto.');

const mixer=new AnimationMixer(g.scene),action=mixer.clipAction(slide);
assert.equal(slideSupportWeight(action),0);action.play();mixer.update(.3);
const movingSupport=slideSupportWeight(action);assert.equal(movingSupport,1);
action.setEffectiveTimeScale(0);mixer.update(1/60);
assert.equal(action.isRunning(),false);assert.equal(slideSupportWeight(action),movingSupport,'Stopping at the platform edge must not lift the penguin');
action.setEffectiveTimeScale(.8);mixer.update(1/60);assert.equal(slideSupportWeight(action),movingSupport);
action.fadeOut(.18);mixer.update(.2);assert.equal(slideSupportWeight(action),0);action.stop();assert.equal(slideSupportWeight(action),0);
console.log('PASS: apoyo continuo al pausar, reanudar y salir del deslizamiento.');
