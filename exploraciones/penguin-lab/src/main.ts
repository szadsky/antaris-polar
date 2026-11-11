import {FootstepAudio} from './footstep-audio';
import {SnowFootprints} from './snow-footprints';
import {PenguinMotion,GAIT_SPEED} from './penguin-motion';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {styleUniforms,stylizedMaterial} from './snow/shaders';
import {loadTerrainTextures} from './snow/terrain-textures';

const status=document.getElementById('status')!;
async function main(){
 const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('scene') as HTMLCanvasElement,antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color('#e1e9ed');
 const camera=new THREE.PerspectiveCamera(36,innerWidth/innerHeight,.05,60);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=2;controls.maxDistance=14;controls.maxPolarAngle=Math.PI*.48;controls.target.set(0,.7,0);
 function reset(){camera.position.set(5,3.5,6.5);controls.target.set(0,.7,0);controls.update();}reset();
 scene.add(new THREE.HemisphereLight('#e2f1ff','#7f8d9d',1.7));
 const sun=new THREE.DirectionalLight('#fff4de',2.6);sun.position.set(3,6,4);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-4,right:4,top:4,bottom:-4,near:.5,far:18});sun.shadow.normalBias=.015;sun.shadow.bias=-.0001;scene.add(sun);
 const radius=2.7,segments=192,rings=96;
 const height=(x:number,z:number)=>.42+.065*(Math.cos(x*.8)*Math.cos(z*.9)-1)+.025*Math.sin(x*1.6)*Math.sin(z*1.2);
 const geometry=new THREE.BufferGeometry(),positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 // Regular radial patch, no DEM and no dependencies on the application's terrain generator.
 for(let r=0;r<=rings;r++)for(let j=0;j<=segments;j++){const a=j/segments*Math.PI*2,d=r/rings*radius,x=Math.cos(a)*d,z=Math.sin(a)*d;positions.push(x,height(x,z),z);uvs.push(x/(radius*2)+.5,z/(radius*2)+.5);}
 for(let r=0;r<rings;r++)for(let j=0;j<segments;j++){const a=r*(segments+1)+j,b=a+segments+1;if(r>0)indices.push(a,a+1,b);indices.push(a+1,b+1,b);}
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('surfUv',new THREE.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
 const n=192,surface=new Uint8Array(n*n*4),light=new Uint8Array(n*n*4);
 for(let row=0;row<n;row++)for(let col=0;col<n;col++){const x=(col/(n-1)-.5)*radius*2,z=(row/(n-1)-.5)*radius*2,e=.005;const normal=new THREE.Vector3(-(height(x+e,z)-height(x-e,z))/(2*e),1,-(height(x,z+e)-height(x,z-e))/(2*e)).normalize(),i=(row*n+col)*4;surface.set([Math.round((normal.x*.5+.5)*255),Math.round((normal.z*.5+.5)*255),255,255],i);light.set([255,0,128,255],i);}
 const texture=(data:Uint8Array)=>{const t=new THREE.DataTexture(data,n,n);t.generateMipmaps=true;t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;return t;};
 const maps={surface:texture(surface),light:texture(light)};
 const uniforms=styleUniforms(maps,{halfSize:[1000,1000],seaY:-100});
 // Same snow shading, grain and glints. This small support uses its explicit geometry:
 // kilometre-scale terrain displacement and shoreline ramp are not applicable here.
 uniforms.uSnowDisp.value.x=0;uniforms.uCoastRamp.value.w=0;
 const snow=stylizedMaterial(uniforms,{variant:'n',exactCoast:true});
 const footprints=new SnowFootprints(radius,n);
 const deformedHeight=(x:number,z:number)=>height(x,z)-footprints.sample(x,z);
 const position=geometry.getAttribute('position') as THREE.BufferAttribute;position.setUsage(THREE.DynamicDrawUsage);
 const buckets=new Map<string,number[]>(),bucketSize=.25;
 for(let i=0;i<position.count;i++){const key=Math.floor(position.getX(i)/bucketSize)+','+Math.floor(position.getZ(i)/bucketSize);const entries=buckets.get(key)??[];entries.push(i);buckets.set(key,entries);}
 let footprintCount=0;
 const counter=document.getElementById('footprint-count')!;
 function refreshSurface(x0:number,x1:number,z0:number,z1:number){
  const e=footprints.cell;
  for(let row=Math.max(0,z0-2);row<=Math.min(n-1,z1+2);row++)for(let col=Math.max(0,x0-2);col<=Math.min(n-1,x1+2);col++){
   const x=col*e-radius,z=row*e-radius,nx=-(deformedHeight(x+e,z)-deformedHeight(x-e,z))/(2*e),nz=-(deformedHeight(x,z+e)-deformedHeight(x,z-e))/(2*e),len=Math.hypot(nx,1,nz),i=(row*n+col)*4;
   surface[i]=Math.round((nx/len*.5+.5)*255);surface[i+1]=Math.round((nz/len*.5+.5)*255);surface[i+2]=Math.round(255*(1-Math.min(.4,footprints.sample(x,z)/footprints.maxDepth*.4)));
  }
  maps.surface.needsUpdate=true;
 }
 let footprintCpuMs=0;
 const normals=geometry.getAttribute('normal') as THREE.BufferAttribute;normals.setUsage(THREE.DynamicDrawUsage);
 function applyFootprintRegion(dirty:{x0:number;x1:number;z0:number;z1:number}){
  const started=performance.now(),e=footprints.cell;
  const minX=(dirty.x0-2)*e-radius,maxX=(dirty.x1+2)*e-radius,minZ=(dirty.z0-2)*e-radius,maxZ=(dirty.z1+2)*e-radius;
  let first=Infinity,last=-1;
  for(let bz=Math.floor(minZ/bucketSize);bz<=Math.floor(maxZ/bucketSize);bz++)for(let bx=Math.floor(minX/bucketSize);bx<=Math.floor(maxX/bucketSize);bx++)for(const i of buckets.get(bx+','+bz)??[]){
   const x=position.getX(i),z=position.getZ(i);position.setY(i,deformedHeight(x,z));
   const nx=-(deformedHeight(x+e,z)-deformedHeight(x-e,z))/(2*e),nz=-(deformedHeight(x,z+e)-deformedHeight(x,z-e))/(2*e),length=Math.hypot(nx,1,nz);
   normals.setXYZ(i,nx/length,1/length,nz/length);first=Math.min(first,i);last=Math.max(last,i);
  }
  if(last>=0){position.addUpdateRange(first*3,(last-first+1)*3);position.needsUpdate=true;normals.addUpdateRange(first*3,(last-first+1)*3);normals.needsUpdate=true;}
  refreshSurface(dirty.x0,dirty.x1,dirty.z0,dirty.z1);
  footprintCpuMs+=performance.now()-started;
 }
 function stampFoot(x:number,z:number,yaw:number){
  const dirty=footprints.stamp(x,z,yaw);if(!dirty)return;
  applyFootprintRegion(dirty);counter.textContent=String(++footprintCount)+' pisadas · se borran en 14 s';
 }
 // The terrain shader normally smooths kilometre-scale normals. Restore only
 // footprint normals at contact scale, keeping its original snow grain and glints.
 const compileSnow=snow.onBeforeCompile.bind(snow);
 snow.onBeforeCompile=(shader,renderer)=>{compileSnow(shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);',
  'vec3 footN=vec3(surf.r*2.0-1.0,0.0,surf.g*2.0-1.0); footN.y=sqrt(max(0.0,1.0-dot(footN.xz,footN.xz))); float footWeight=1.0-smoothstep(.985,1.0,surf.b); normal=normalize((viewMatrix*vec4(normalize(gN+(footN-nSm)*footWeight),0.0)).xyz);');};
 snow.customProgramCacheKey=()=> 'antaris-snow-footprints-v1';
 const top=new THREE.Mesh(geometry,snow);top.receiveShadow=true;top.castShadow=true;scene.add(top);
 const sidePos:number[]=[],sideIndices:number[]=[];
 for(let j=0;j<=segments;j++){const a=j/segments*Math.PI*2,x=Math.cos(a)*radius,z=Math.sin(a)*radius;sidePos.push(x,height(x,z),z,x,-.02,z);if(j<segments){const k=j*2;sideIndices.push(k,k+2,k+1,k+2,k+3,k+1);}}
 const sideGeo=new THREE.BufferGeometry();sideGeo.setAttribute('position',new THREE.Float32BufferAttribute(sidePos,3));sideGeo.setIndex(sideIndices);sideGeo.computeVertexNormals();
 const side=new THREE.Mesh(sideGeo,new THREE.MeshStandardMaterial({color:'#a8c7d8',roughness:.85}));side.castShadow=true;side.receiveShadow=true;scene.add(side);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#e1e9ed',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.025;floor.receiveShadow=true;scene.add(floor);
 const [gltf]=await Promise.all([new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'assets/models/penguin.glb?v=7cafd92bcfae'),loadTerrainTextures(renderer,renderer.capabilities.getMaxAnisotropy())]);
 const penguin=gltf.scene;const box=new THREE.Box3().setFromObject(penguin),extent=box.getSize(new THREE.Vector3());penguin.scale.setScalar(1.25/extent.y);box.setFromObject(penguin);const center=box.getCenter(new THREE.Vector3());penguin.position.set(-center.x,-box.min.y,-center.z);penguin.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});const character=new THREE.Group();character.add(penguin);character.position.y=height(0,0);scene.add(character);
 const mixer=new THREE.AnimationMixer(penguin);
 const actions=new Map(gltf.animations.map(clip=>[clip.name.toLowerCase(),mixer.clipAction(clip)]));
 // Sample the authored Swim pose once to keep the belly on the snow, not floating.
 const swim=actions.get('swim'),swimFloor:number[]=[],swimSamples=32;
 if(swim){swim.play();const bounds=new THREE.Box3();for(let i=0;i<swimSamples;i++){mixer.setTime(i/swimSamples*swim.getClip().duration);character.updateMatrixWorld(true);bounds.setFromObject(penguin,true);swimFloor.push(bounds.min.y-character.position.y);}mixer.stopAllAction();mixer.setTime(0);}
 let active=actions.get('idle');active?.play();
 const stepAudio=new FootstepAudio(import.meta.env.BASE_URL+'assets/audio/footstepOnSnow1Medium.ogg');
 const soundButton=document.getElementById('step-sound')!;
 soundButton.onclick=()=>{stepAudio.setEnabled(!stepAudio.enabled);soundButton.textContent=stepAudio.enabled?'Sonido activado':'Sonido silenciado';soundButton.setAttribute('aria-pressed',String(stepAudio.enabled));};
 const unlockAudio=()=>stepAudio.unlock();renderer.domElement.addEventListener('pointerdown',unlockAudio);
 const motion=new PenguinMotion(radius-.4),keys=new Set<string>();
 const feet=['LeftHindToe','RightHindToe'].map(name=>({bone:penguin.getObjectByName(name)!,point:new THREE.Vector3(),contact:false,last:new THREE.Vector2(Infinity,Infinity)}));
 let wasAirborne=false;
 let slideTrail:THREE.Vector2|null=null;
 document.getElementById('clear-snow')!.onclick=()=>{slideTrail=null;footprints.clear();for(let i=0;i<position.count;i++)position.setY(i,height(position.getX(i),position.getZ(i)));position.needsUpdate=true;geometry.computeVertexNormals();refreshSurface(0,n-1,0,n-1);footprintCount=0;counter.textContent='0 huellas';for(const foot of feet){foot.contact=false;foot.last.set(Infinity,Infinity);}};
 const forward=new THREE.Vector3(),right=new THREE.Vector3(),direction=new THREE.Vector3(),rotation=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0);
 const movementStatus=document.getElementById('movement-status')!;let lastState='';
 let animated=!matchMedia('(prefers-reduced-motion: reduce)').matches,disposed=false;const button=document.getElementById('animate')!;
 const sync=()=>{button.textContent=animated?'Reposo animado':'Reposo quieto';button.setAttribute('aria-pressed',String(animated));};sync();button.onclick=()=>{animated=!animated;sync();};document.getElementById('reset')!.onclick=reset;
 const relevant=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyR','KeyE']);
 const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');
 const keydown=(event:KeyboardEvent)=>{if(!relevant.has(event.code)||editable(event.target)||event.ctrlKey||event.metaKey||event.altKey)return;if(event.code==='Space'&&event.target instanceof HTMLElement&&event.target.closest('button,a'))return;event.preventDefault();stepAudio.unlock();keys.add(event.code);if(event.repeat)return;if(event.code==='Space'&&!keys.has('KeyE'))motion.jump();if(event.code==='KeyR'){keys.clear();slideTrail=null;motion.reset();character.quaternion.identity();}};
 const keyup=(event:KeyboardEvent)=>{keys.delete(event.code);};const clearKeys=()=>{keys.clear();slideTrail=null;stepAudio.stop();};
 window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',clearKeys);
 function move(dt:number){
  camera.getWorldDirection(forward);forward.y=0;forward.normalize();right.crossVectors(forward,up).normalize();
  const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
  const z=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
  direction.copy(right).multiplyScalar(x).addScaledVector(forward,z);
  const oldX=motion.x,oldZ=motion.z;
  motion.step(direction.x,direction.z,keys.has('ShiftLeft')||keys.has('ShiftRight'),dt,keys.has('KeyE')&&!!swim);
  if(motion.sliding&&motion.moving){
   slideTrail??=new THREE.Vector2(oldX,oldZ);
   // Update after 4 cm of travel, sweeping the entire interval without gaps.
   if(Math.hypot(motion.x-slideTrail.x,motion.z-slideTrail.y)>=.04){
    const dirty=footprints.groove(slideTrail.x,slideTrail.y,motion.x,motion.z);
    if(dirty)applyFootprintRegion(dirty);
    slideTrail.set(motion.x,motion.z);counter.textContent='Surco en la nieve · se borra en 14 s';
   }
  }else slideTrail=null;
  character.position.set(motion.x,deformedHeight(motion.x,motion.z)+motion.y,motion.z);
  rotation.setFromAxisAngle(up,motion.yaw);character.quaternion.slerp(rotation,1-Math.exp(-20*dt));
  const state=motion.y>0?'saltando':motion.sliding?'deslizándose':motion.running?'corriendo':motion.moving?'caminando':'en reposo';
  const groundSpeed=dt>0?Math.hypot(motion.x-oldX,motion.z-oldZ)/dt:0;
  const next=actions.get(motion.sliding?'swim':motion.running?'run':motion.moving?'walk':'idle');
  if(next&&next!==active){
   const oldPhase=active&&active!==swim&&next!==swim&&active!==actions.get('idle')?active.time/active.getClip().duration:0;
   next.reset();if(next!==actions.get('idle'))next.time=oldPhase*next.getClip().duration;
   const transition=(next===swim||active===swim) ? .18 : .06;next.fadeIn(transition).play();active?.fadeOut(transition);active=next;
  }
  // Match backwards travel of the planted foot to actual forward travel of the body.
  if(next===swim&&next)next.setEffectiveTimeScale(motion.moving?.8:0);
  else if(next&&motion.moving)next.setEffectiveTimeScale(groundSpeed/(motion.running?GAIT_SPEED.run:GAIT_SPEED.walk));
  else if(next)next.setEffectiveTimeScale(1);
  if(animated||motion.moving||motion.sliding||motion.y>0||swim?.isRunning())mixer.update(dt);
  if(swim&&swim.isRunning()&&swimFloor.length){const phase=swim.time/swim.getClip().duration*swimSamples,i=Math.floor(phase)%swimSamples;const floor=THREE.MathUtils.lerp(swimFloor[i],swimFloor[(i+1)%swimSamples],phase-Math.floor(phase));character.position.y-=floor*swim.getEffectiveWeight();}
  character.updateMatrixWorld(true);
  const airborne=motion.y>0||motion.verticalSpeed>0,landed=wasAirborne&&!airborne;
  for(const foot of feet){
   foot.bone.getWorldPosition(foot.point);
   const gap=foot.point.y-deformedHeight(foot.point.x,foot.point.z);
   const contact=!motion.sliding&&!(swim&&swim.getEffectiveWeight()>.01&&swim.isRunning())&&!airborne&&gap<(foot.contact?.045:.028);
   const distance=foot.last.distanceTo(new THREE.Vector2(foot.point.x,foot.point.z));
   if(contact&&((!foot.contact&&motion.moving)||landed)&&distance>.12){
    stampFoot(foot.point.x,foot.point.z,character.rotation.y);stepAudio.play(motion.running,landed);foot.last.set(foot.point.x,foot.point.z);
   }
   foot.contact=contact;
  }
  wasAirborne=airborne;
  if(state!==lastState){lastState=state;movementStatus.textContent='Pingüino '+state;}
 }
 let fadeElapsed=0,perfStarted=performance.now(),perfFrames=0;const perfLabel=document.getElementById('performance')!;
 const clock=new THREE.Clock();const resize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};window.addEventListener('resize',resize);
 renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05);if(document.hidden)return;controls.update();
 fadeElapsed+=dt;if(fadeElapsed>=.1){const start=performance.now(),dirty=footprints.fade(fadeElapsed);footprintCpuMs+=performance.now()-start;fadeElapsed=0;if(dirty)applyFootprintRegion(dirty);if(footprints.active.size===0){footprintCount=0;counter.textContent='Nieve sin huellas';}}
 move(dt);renderer.render(scene,camera);
 perfFrames++;const elapsed=performance.now()-perfStarted;if(elapsed>=2000){perfLabel.textContent=Math.round(perfFrames*1000/elapsed)+' FPS · huellas CPU '+(footprintCpuMs/perfFrames).toFixed(2)+' ms/cuadro';perfStarted=performance.now();perfFrames=0;footprintCpuMs=0;}});status.hidden=true;
 window.addEventListener('pagehide',()=>{if(disposed)return;disposed=true;stepAudio.dispose();renderer.domElement.removeEventListener('pointerdown',unlockAudio);renderer.setAnimationLoop(null);window.removeEventListener('resize',resize);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',clearKeys);document.removeEventListener('visibilitychange',clearKeys);controls.dispose();mixer.stopAllAction();mixer.uncacheRoot(penguin);const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const m of materials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);m.dispose();}for(const u of Object.values(uniforms))if(u.value instanceof THREE.Texture)textures.add(u.value);for(const t of textures)t.dispose();sun.shadow.map?.dispose();renderer.dispose();},{once:true});
}
main().catch(error=>{status.hidden=false;status.textContent='No se pudo preparar la prueba: '+String(error);console.error(error);});
