import fs from 'node:fs';import assert from 'node:assert/strict';import * as T from 'three';import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';import {GAIT_SPEED,MOVE_SPEED} from './src/penguin-motion.ts';
const b=fs.readFileSync('public/assets/models/penguin-custom-smooth.glb'),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const box=new T.Box3().setFromObject(g.scene);g.scene.scale.setScalar(1.25/box.getSize(new T.Vector3()).y);box.setFromObject(g.scene);g.scene.position.y=-box.min.y;
for(const gait of ['walk','run']){
 const clip=g.animations.find(c=>c.name.toLowerCase()===gait),m=new T.AnimationMixer(g.scene),a=m.clipAction(clip);a.play();
 const foot=g.scene.getObjectByName(gait==='walk'?'RightHindToe':'LeftHindToe'),v=new T.Vector3();
 const start=gait==='walk'?.02:.1,dt=.08,scale=MOVE_SPEED[gait]/GAIT_SPEED[gait];
 m.setTime(start);g.scene.updateMatrixWorld(true);foot.getWorldPosition(v);const z=v.z;
 m.setTime(start+dt*scale);g.scene.updateMatrixWorld(true);foot.getWorldPosition(v);
 const slip=Math.abs(v.z-z+MOVE_SPEED[gait]*dt);
 assert(slip<.005,`${gait}: planted-foot drift ${slip}m`);
 console.log(`${gait}: deslizamiento en apoyo ${(slip*1000).toFixed(2)} mm / ${dt*1000} ms`);m.stopAllAction();m.uncacheRoot(g.scene);
}
