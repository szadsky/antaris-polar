import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
// Offline preparation: preserve custom positions and skinning, transfer motion,
// and smooth coincident vertex normals without welding color or joint seams.
const [customPath,donorPath,outputPath]=process.argv.slice(2);
if(!outputPath)throw Error('Usage: node scripts/prepare-penguin.mjs custom.glb animated.glb output.glb');
globalThis.FileReader=class {readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}};
const load=async p=>{const b=await fs.readFile(p);return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const [custom,donor]=await Promise.all([load(customPath),load(donorPath)]);
const animations=donor.animations.map(clip=>{const copy=clip.clone();for(const track of copy.tracks){const binding=THREE.PropertyBinding.parseTrackName(track.name),a=donor.scene.getObjectByName(binding.nodeName),b=custom.scene.getObjectByName(binding.nodeName);if(!a||!b)throw Error('Missing animation target '+binding.nodeName);if(binding.propertyName==='position'){const offset=b.position.clone().sub(a.position);for(let i=0;i<track.values.length;i+=3){track.values[i]+=offset.x;track.values[i+1]+=offset.y;track.values[i+2]+=offset.z;}}}return copy;});
let vertices=0;
custom.scene.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,p=g.getAttribute('position'),skin=g.getAttribute('skinIndex'),weight=g.getAttribute('skinWeight');const original=p.array.slice();g.computeVertexNormals();const n=g.getAttribute('normal'),groups=new Map();
for(let i=0;i<p.count;i++){let key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');if(skin&&weight)key+=':'+Array.from({length:4},(_,k)=>skin.getComponent(i,k)+'/'+Math.round(weight.getComponent(i,k)*1e5)).join(',');let group=groups.get(key);if(!group){group={ids:[],sum:new THREE.Vector3()};groups.set(key,group);}group.ids.push(i);group.sum.x+=n.getX(i);group.sum.y+=n.getY(i);group.sum.z+=n.getZ(i);}
for(const {ids,sum} of groups.values()){sum.normalize();for(const i of ids)n.setXYZ(i,sum.x,sum.y,sum.z);}n.needsUpdate=true;
for(const m of Array.isArray(o.material)?o.material:[o.material]){m.flatShading=false;m.needsUpdate=true;}
if(p.array.some((v,i)=>v!==original[i]))throw Error('Positions changed');vertices+=p.count;
});
const binary=await new GLTFExporter().parseAsync(custom.scene,{binary:true,animations,onlyVisible:false});await fs.writeFile(outputPath,Buffer.from(binary));console.log({vertices,animations:animations.map(c=>c.name),bytes:binary.byteLength});
