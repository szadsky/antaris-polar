import { mountSiteNav } from '../../../compartido/navbar/navbar';
// Navegación común, salvo incrustada en otra página (?embed, la sección del home): ahí la barra es la de esa página.
const embed = new URLSearchParams(location.search).has('embed');
if (!embed) mountSiteNav({ actual: 'islas' });
// Incrustada no hay barra: el mismo margen superior deja la interfaz fuera de la viñeta del home.
else { document.documentElement.style.setProperty('--site-nav-h', '36px'); document.documentElement.classList.add('embed'); }
// Incrustada, la página que la contiene la pausa cuando la sección sale de vista (mismo origen): no dibuja de más.
const parentOrigin=new URLSearchParams(location.search).get('parentOrigin')||location.origin;
let embedPausado = false;
if(embed)window.addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage('antaris:close',parentOrigin);});
if (embed) window.addEventListener('message', (e) => {
  if (e.source!==parent || e.origin !== parentOrigin) return;
  if(e.data?.type==='antaris:control' && ['step-sound','reset'].includes(e.data.id)){document.getElementById(e.data.id)?.click();parent.postMessage({type:'antaris:sound',text:document.getElementById('step-sound')?.textContent},parentOrigin);}
  if (e.data === 'antaris:pausa') embedPausado = true;
  else if (e.data === 'antaris:sigue') embedPausado = false;
});
import {applyKingPenguinColors} from './king-penguin-colors';
import {groundedSlideClip,slideSupportWeight} from './slide-animation';
import {FootstepAudio} from './footstep-audio';
import {PenguinMotion,GAIT_SPEED,MOVE_SPEED} from './penguin-motion';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {placeIslandBase,STRUCTURES,type IslandStructure} from './island/island-base';
import {savedPose,setupBaseEditor} from './island/base-editor';
import {loadTerrainTextures} from './snow/terrain-textures';
import {TERRAINS,terrainSpec,IslandTerrain,findSpawn} from './island/island-terrain';
import {buildIslandMaps} from './island/island-maps';
import {noiseTexture,detailTexture} from './snow/materials';
import {detailTextureCorrected} from './snow/detail-corrected';
import {createConstruction} from './snow/construction';
import {IslandGround,SUN_DIRECTION} from './island/island-scene';
import {SnowParticles} from './snow-particles';
import {setupUiToggle} from './ui-toggle';
import {setupTouchControls} from './touch-controls';

const status=document.getElementById('status')!;
setupUiToggle(document.getElementById('toggle-ui') as HTMLButtonElement);
// Pantalla táctil: interfaz compacta desde el primer cuadro (los controles táctiles se arman después de cargar).
if(matchMedia('(pointer: coarse)').matches)document.body.classList.add('touch');
// Terreno: ?terreno=sendero (por defecto), macizo o valle. Relieve sintético, no geografía real.
const spec=terrainSpec(new URLSearchParams(location.search).get('terreno'));
const cameraAzimuth=()=>CAMERA_AZIMUTH[spec.id]??spec.viewAzimuth;
/** Cámara en perspectiva 3/4 elevada: distancia (m), elevación (rad) y altura del punto de mira. */
const VIEW={distance:30.7,elevation:.609,lookHeight:.55}; // vista medio isométrica elegida el 16/11/2026 (antes 15 m y 46°)
/** Acimut de la cámara al empezar y al restablecer la vista, por isla (rad; 0 = cámara al sur). Sin dato: el de la isla.
 *  Solo es el punto de partida: la cámara sigue libre (girar, acercar y alejar). */
const CAMERA_AZIMUTH:Record<string,number>={sendero:2.672};
const BACKGROUND='#e1e9ed';

async function main(){
 const nav=document.getElementById('islands')!;
 for(const terrain of TERRAINS){const link=document.createElement('a');link.href='?terreno='+terrain.id;link.textContent=terrain.name;link.title=terrain.summary;if(terrain.id===spec.id)link.setAttribute('aria-current','page');nav.append(link);}
 document.getElementById('island-summary')!.textContent=spec.summary;
 const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('scene') as HTMLCanvasElement,antialias:true});
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 const scene=new THREE.Scene();scene.background=new THREE.Color(BACKGROUND);scene.fog=new THREE.Fog(BACKGROUND,38,120);
 const camera=new THREE.PerspectiveCamera(36,innerWidth/innerHeight,.1,320);
 // Pantallas verticales (móvil): se abre el campo visual para conservar ≥ 34° horizontales.
 const fitCamera=()=>{camera.aspect=innerWidth/innerHeight;camera.fov=Math.max(36,2*Math.atan(Math.tan(17*Math.PI/180)/camera.aspect)*180/Math.PI);camera.updateProjectionMatrix();};fitCamera();
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=3.5;controls.maxDistance=90; // hasta ver la isla entera (Sendero: ~55 m en diagonal)controls.minPolarAngle=.3;controls.maxPolarAngle=1.3;controls.enablePan=false;
 scene.add(new THREE.HemisphereLight('#e2f1ff','#7f8d9d',1.7));
 // Sol: la sombra del relieve va horneada en la textura de luz; en tiempo real solo proyecta el pingüino,
 // con un mapa pequeño que lo sigue (nítido y barato).
 const sunOffset=new THREE.Vector3(...SUN_DIRECTION).normalize().multiplyScalar(12);
 const sun=new THREE.DirectionalLight('#fff4de',2.6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-2.2,right:2.2,top:2.2,bottom:-2.2,near:2,far:26});sun.shadow.normalBias=.015;sun.shadow.bias=-.0001;scene.add(sun,sun.target);

 const started=performance.now();
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
 // Precarga (la del visor de bases, snow/construction.ts): con las alturas de la isla, una malla que se arma por pasos
 // mientras se preparan los mapas, el material, el agua y el pingüino; al terminar, se transforma en la isla desde el
 // punto de aparición. Relieve SINTÉTICO, no REMA.
 const islandTerrain=new IslandTerrain(spec);
 const home=findSpawn(islandTerrain);
 {const look=new THREE.Vector3(home.x,islandTerrain.sample(home.x,home.z)+VIEW.lookHeight,home.z),a=cameraAzimuth(),h=Math.cos(VIEW.elevation)*VIEW.distance;
  camera.position.set(look.x+Math.sin(a)*h,look.y+Math.sin(VIEW.elevation)*VIEW.distance,look.z+Math.cos(a)*h);controls.target.copy(look);controls.update();}
 const gridCell=2*islandTerrain.half/64; // separación de la malla fina de la precarga (65 nodos por lado)
 const construction=createConstruction({renderer,camera,controls,background:new THREE.Color(BACKGROUND),k:1,reducedMotion,
  preview:{heights:islandTerrain.heights,width:islandTerrain.n,height:islandTerrain.n,cellM:islandTerrain.cell,seaLevelM:islandTerrain.seaY},
  // escalas de la isla: tierra desde 2 cm sobre el agua, tolerancia de un cuarto de celda bajo la superficie (en el visor,
  // 25 m con celdas de ~100 m), malla 2 cm sobre el suelo, 1 m de margen en el radio final y solo la malla de la isla (delimitada por la costa)
  scale:{center:[home.x,home.z],landM:.02,tolM:.25*gridCell,liftM:.02,extraM:1,landOnly:true}});
 construction.start();
 let preloading=true;
 // Base antártica: modelo decorativo (reconstrucción artística), comprimido con Meshopt y texturas WebP.
 // Estructuras (base antártica, estación de comunicaciones): modelos decorativos, reconstrucciones artísticas.
 // Lugar: el elegido con "Mover estructuras" (guardado en el navegador), ?<id>X, ?<id>Z, ?<id>Giro, ?<id>Alto o el fijo de la
 // isla; si no, automático. ?base=no quita todas.
 const params=new URLSearchParams(location.search),withStructures=params.get('base')!=='no';
 const structureLoader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
 const structureModels=Promise.all((withStructures?STRUCTURES:[]).map(st=>structureLoader.loadAsync(import.meta.env.BASE_URL+st.url).catch(e=>{console.warn('Sin '+st.name+':',e);return null;})));
 const assets=Promise.all([new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'assets/models/penguin-custom-smooth.glb'),loadTerrainTextures(renderer,renderer.capabilities.getMaxAnisotropy()),structureModels]);
 // El trabajo pesado va en tramos, con un cuadro entre cada uno: la malla sigue animada.
 const nextFrame=()=>new Promise(r=>requestAnimationFrame(()=>r(null)));
 await nextFrame();noiseTexture();await nextFrame();detailTexture();await nextFrame();detailTextureCorrected();await nextFrame();
 const maps=buildIslandMaps(islandTerrain,SUN_DIRECTION);await nextFrame();
 const ground=new IslandGround(spec,{terrain:islandTerrain,maps,mobile:matchMedia("(pointer: coarse)").matches,maxAniso:renderer.capabilities.getMaxAnisotropy()});scene.add(ground.group);
 ground.ocean.setSun(new THREE.Vector3(...SUN_DIRECTION),sun.color);
 const terrain=ground.terrain;
 const [gltf,textures,structureGltfs]=await assets;
 // Una por una: las automáticas no pisan a las ya ubicadas (1 m de separación).
 const structures:{spec:typeof STRUCTURES[number];s:IslandStructure}[]=[];
 structureGltfs.forEach((g,i)=>{if(!g)return;const st=STRUCTURES[i];
  const s=placeIslandBase(g,terrain,ground.spawn,spec.viewAzimuth,savedPose(st,spec.id),{name:st.name,flag:st.flag,lamps:st.lamps,avoid:(x,z)=>structures.some(o=>o.s.blocks(x,z,1))});
  if(!s.placed)console.warn(st.name+': sin lugar llano en esta isla');scene.add(s.group);structures.push({spec:st,s});});
 // Reflejo del agua más liviano: cada estructura se dibuja en él con su versión simplificada; las que están lejos del
 // agua (su reflejo no puede verse), ni eso. Se revisa al mover una estructura.
 const mirrorSwap=ground.ocean.mirrorSwap!,baseHide=mirrorSwap.hide.slice(),baseShow=mirrorSwap.show.slice();
 const updateMirrorList=()=>{
  const near=structures.filter(o=>o.s.nearWater()),far=structures.filter(o=>!o.s.nearWater());
  mirrorSwap.hide.splice(0,mirrorSwap.hide.length,...baseHide,...far.map(o=>o.s.group),...near.flatMap(o=>o.s.mirror?[o.s.mirror.full]:[]));
  mirrorSwap.show.splice(0,mirrorSwap.show.length,...baseShow,...near.flatMap(o=>o.s.mirror?[o.s.mirror.low]:[]));};
 updateMirrorList();
 if(structures.length)setupBaseEditor({items:structures,island:spec.id,islandName:spec.name,canvas:renderer.domElement,camera,controls,ground:scene.getObjectByName('isla')!,seaY:terrain.seaY,
  container:document.querySelector('.controls') as HTMLElement,onChange:()=>{updateMirrorList();ground.ocean.refresh();pushOut();}});
 const penguin=gltf.scene;applyKingPenguinColors(penguin);const box=new THREE.Box3().setFromObject(penguin),extent=box.getSize(new THREE.Vector3());penguin.scale.setScalar(1.25/extent.y);box.setFromObject(penguin);const center=box.getCenter(new THREE.Vector3());penguin.position.set(-center.x,-box.min.y,-center.z);penguin.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});const character=new THREE.Group();character.add(penguin);scene.add(character);
 const mixer=new THREE.AnimationMixer(penguin);
 const actions=new Map(gltf.animations.map(clip=>[clip.name.toLowerCase(),mixer.clipAction(clip.name.toLowerCase()==='swim'?groundedSlideClip(clip):clip)]));
 // Fixed belly support: moving flippers must not lift the whole character.
 const swim=actions.get('swim');let swimFloor=0;
 if(swim){swim.play();mixer.setTime(0);character.updateMatrixWorld(true);swimFloor=new THREE.Box3().setFromObject(penguin,true).min.y-character.position.y;mixer.stopAllAction();mixer.setTime(0);}
 let active=actions.get('idle');active?.play();
 // Pisadas: crujido de nieve sintetizado; ?pisadas=muestra usa la grabación anterior para comparar.
 const stepAudio=new FootstepAudio(import.meta.env.BASE_URL+'assets/audio/footstepOnSnow1Medium.ogg',new URLSearchParams(location.search).get('pisadas')==='muestra'?'muestra':'nieve');
 const soundButton=document.getElementById('step-sound')!;
 soundButton.onclick=()=>{stepAudio.setEnabled(!stepAudio.enabled);soundButton.textContent=stepAudio.enabled?'Sonido activado':'Sonido silenciado';soundButton.setAttribute('aria-pressed',String(stepAudio.enabled));};
 const unlockAudio=()=>stepAudio.unlock();renderer.domElement.addEventListener('pointerdown',unlockAudio);
 // Sin límite circular: la isla decide dónde se puede pisar (agua y laderas de más de 34° bloquean).
 // Hielo (lagunas, glaciares, toboganes): se desliza solo, con inercia (src/penguin-motion.ts, ICE).
  // Estructuras: no se entran ni se atraviesan. Si una quedara encima del pingüino (al moverla), pushOut lo saca.
 const motion=new PenguinMotion(Infinity,(x,z)=>terrain.canStand(x,z)&&!structures.some(o=>o.s.blocks(x,z)),(x,z)=>terrain.gradient(x,z),(x,z)=>terrain.ice(x,z));motion.setHome(ground.spawn.x,ground.spawn.z,cameraAzimuth()-.75); // de tres cuartos hacia la cámara
 // Puede bajar por laderas empinadas y caer de los bordes (no queda trabado arriba de lo que escaló); no al agua ni dentro de una estructura.
 motion.fall={height:(x,z)=>terrain.sample(x,z),canLand:(x,z)=>terrain.canLand(x,z)&&!structures.some(o=>o.s.blocks(x,z))};
 const feet=['LeftHindToe','RightHindToe'].map(name=>({bone:penguin.getObjectByName(name)!,point:new THREE.Vector3(),contact:false,last:new THREE.Vector2(Infinity,Infinity)}));
 let wasAirborne=false;
 let slideTrail:THREE.Vector2|null=null;
 // Partículas de nieve (pisadas, aterrizajes y estela al deslizar sobre nieve blanda).
 const snowParticles=new SnowParticles();scene.add(snowParticles.points);snowParticles.setViewport(renderer.domElement.height,camera.fov);
 let sprayDebt=0;
 let footprintCount=0;
 const counter=document.getElementById('footprint-count')!;
 const clearFeet=()=>{for(const foot of feet){foot.contact=false;foot.last.set(Infinity,Infinity);}};
 document.getElementById('clear-snow')!.onclick=()=>{slideTrail=null;ground.clear();footprintCount=0;counter.textContent='0 huellas';clearFeet();};
 const forward=new THREE.Vector3(),right=new THREE.Vector3(),direction=new THREE.Vector3(),rotation=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0);
 const lookTarget=new THREE.Vector3(),follow=new THREE.Vector3();
 function placeCharacter(){character.position.set(motion.x,ground.height(motion.x,motion.z)+motion.y,motion.z);character.quaternion.setFromAxisAngle(up,motion.yaw);}
 function reset(){
  // Encuadre 3/4 elevado detrás del pingüino según la isla (acimut fijo, no gira con él).
  lookTarget.set(motion.x,ground.height(motion.x,motion.z)+VIEW.lookHeight,motion.z);
  const a=cameraAzimuth(),h=Math.cos(VIEW.elevation)*VIEW.distance;
  camera.position.set(lookTarget.x+Math.sin(a)*h,lookTarget.y+Math.sin(VIEW.elevation)*VIEW.distance,lookTarget.z+Math.cos(a)*h);
  controls.target.copy(lookTarget);controls.update();
 }
 /** Si una estructura quedó encima del pingüino, lo saca por el borde más cercano (a tierra firme). */
 function pushOut(){for(const o of structures){if(!o.s.blocks(motion.x,motion.z))continue;const out=o.s.exits(motion.x,motion.z).find(([x,z])=>terrain.canStand(x,z)&&!structures.some(q=>q.s.blocks(x,z)));if(out){motion.x=out[0];motion.z=out[1];motion.y=0;motion.verticalSpeed=0;}}}
 motion.reset();pushOut();placeCharacter();reset();
 const destinations:Record<string,{label:string;url:string}>={base:{label:'Bases',url:'/descubrir/'},comunicaciones:{label:'Investigaciones',url:'/investigaciones/'},antena:{label:'Noticias',url:'/noticias/'},oruga:{label:'AntarisPlay',url:'/antarisplay/'}};
 const stations=structures.map(o=>{
  const destination=destinations[o.spec.id],a=document.createElement('a');a.className='island-station';a.textContent=destination.label;a.href=destination.url;a.target='_top';a.setAttribute('aria-label',destination.label+' · '+o.spec.name);
  if(!embed)document.body.append(a);
  const bounds=new THREE.Box3().setFromObject(o.s.group),anchor=bounds.getCenter(new THREE.Vector3());anchor.y=bounds.max.y+.4;
  return {id:o.spec.id,a,anchor};
 });
 function updateStations(){
  // Project against the same camera matrices as the frame being rendered.
  camera.updateMatrixWorld();
  const positions=stations.map(st=>{const v=st.anchor.clone().project(camera);const shown=v.z>=-1&&v.z<=1&&Math.abs(v.x)<.90&&v.y>-.84&&v.y<.78;
   st.a.hidden=!shown;st.a.style.left=((v.x+1)*innerWidth/2)+'px';st.a.style.top=((1-v.y)*innerHeight/2)+'px';return {id:st.id,x:(v.x+1)/2,y:(1-v.y)/2,shown};
  });
  if(embed)parent.postMessage({type:'antaris:stations',positions},parentOrigin);
 }

 // Shared hover/picking for the model, its label, and the inactive home overlay.
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
 const pickMeshes:THREE.Mesh[]=[];
 const owners=new Map<THREE.Object3D,string>();
 const outlines=new Map<string,THREE.LineSegments[]>();
 for(const o of structures){
  const edges:THREE.LineSegments[]=[];
  o.s.group.traverse(obj=>{if(!(obj instanceof THREE.Mesh))return;pickMeshes.push(obj);owners.set(obj,o.spec.id);});
  for(const mesh of pickMeshes.filter(m=>owners.get(m)===o.spec.id)){
   const line=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,35),new THREE.LineBasicMaterial({color:0x6dc9ef,transparent:true,opacity:.8,depthWrite:false}));
   line.visible=false;line.renderOrder=3;mesh.add(line);edges.push(line);
  }
  outlines.set(o.spec.id,edges);
 }
 let hovered:string|null=null;
 function hoverStation(id:string|null){
  if(hovered===id)return;hovered=id;
  for(const [key,edges] of outlines)for(const edge of edges)edge.visible=key===id;
  for(const st of stations)st.a.classList.toggle('is-hovered',st.id===id);
  renderer.domElement.style.cursor=id?'pointer':'';
  if(embed)parent.postMessage({type:'antaris:hover',id},parentOrigin);
 }
 function pickStation(x:number,y:number){
  if(preloading)return null;
  pointer.set(x*2-1,1-y*2);camera.updateMatrixWorld();scene.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObjects(pickMeshes,false)[0];return hit?owners.get(hit.object)??null:null;
 }
 function openStation(id:string|null){
  if(!id||!destinations[id])return;
  if(embed)parent.postMessage({type:'antaris:navigate',id},parentOrigin);
  else location.assign(destinations[id].url);
 }
 const canvas=renderer.domElement;
 let press:{x:number;y:number;id:string|null;dragged:boolean}|null=null;
 const point=(e:PointerEvent)=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height};};
 canvas.addEventListener('pointermove',e=>{if(mobileNavigation)return;if(press&&Math.hypot(e.clientX-press.x,e.clientY-press.y)>6)press.dragged=true;const p=point(e);hoverStation(press?.dragged?null:pickStation(p.x,p.y));});
 canvas.addEventListener('pointerleave',()=>hoverStation(null));
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=point(e);press={x:e.clientX,y:e.clientY,id:pickStation(p.x,p.y),dragged:false};});
 canvas.addEventListener('pointerup',e=>{if(mobileNavigation){press=null;return;}const start=press;press=null;if(!start||start.dragged||Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;const p=point(e),id=pickStation(p.x,p.y);if(id===start.id)openStation(id);});
 canvas.addEventListener('pointercancel',()=>{press=null;hoverStation(null);});
 for(const st of stations){st.a.addEventListener('pointerenter',()=>hoverStation(st.id));st.a.addEventListener('pointerleave',()=>hoverStation(null));st.a.addEventListener('focus',()=>hoverStation(st.id));st.a.addEventListener('blur',()=>hoverStation(null));}
 window.addEventListener('message',e=>{
  if(!embed||e.source!==parent||e.origin!==parentOrigin)return;
  if(!matchMedia('(pointer: coarse)').matches&&e.data?.type==='antaris:label-hover')hoverStation(destinations[e.data.id]?e.data.id:null);
  if(!matchMedia('(pointer: coarse)').matches&&e.data?.type==='antaris:pick'&&Number.isFinite(e.data.x)&&Number.isFinite(e.data.y)){
   const id=pickStation(e.data.x,e.data.y);hoverStation(id);if(e.data.click)openStation(id);
  }
 });

 const mobileNavigation=matchMedia('(pointer: coarse)').matches;
 let touchExploring=!embed;
 let nearId:string|null=null;
 const proximity=structures.map(o=>({id:o.spec.id,bounds:new THREE.Box3().setFromObject(o.s.group)}));
 function updateProximity(){
  if(!mobileNavigation)return;
  let id:string|null=null,best=2.8;
  if(touchExploring)for(const item of proximity){
   const b=item.bounds,dx=motion.x-Math.max(b.min.x,Math.min(b.max.x,motion.x)),dz=motion.z-Math.max(b.min.z,Math.min(b.max.z,motion.z));
   const distance=Math.hypot(dx,dz);if(distance<best){best=distance;id=item.id;}
  }
  hoverStation(id);
  if(id!==nearId){nearId=id;if(embed)parent.postMessage({type:'antaris:nearby',id},parentOrigin);}
 }
 const movementStatus=document.getElementById('movement-status')!;let lastState='';
 let animated=!matchMedia('(prefers-reduced-motion: reduce)').matches,disposed=false;const button=document.getElementById('animate')!;
 const sync=()=>{button.textContent=animated?'Reposo animado':'Reposo quieto';button.setAttribute('aria-pressed',String(animated));};sync();button.onclick=()=>{animated=!animated;sync();};document.getElementById('reset')!.onclick=reset;
 const keys=new Set<string>();
 const relevant=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyR','KeyE']);
 const editable=(target:EventTarget|null)=>target instanceof HTMLElement&&!!target.closest('input,textarea,select,[contenteditable="true"]');
 const keydown=(event:KeyboardEvent)=>{if(!relevant.has(event.code)||editable(event.target)||event.ctrlKey||event.metaKey||event.altKey)return;if(event.code==='Space'&&event.target instanceof HTMLElement&&event.target.closest('button,a'))return;event.preventDefault();stepAudio.unlock();keys.add(event.code);if(event.repeat)return;if(event.code==='Space'&&!keys.has('KeyE'))motion.jump();if(event.code==='KeyR'){keys.clear();slideTrail=null;motion.reset();clearFeet();placeCharacter();reset();}};
 // Táctil: joystick (caminar; al borde, correr), Saltar y Deslizar (mantener). Ver src/touch-controls.ts.
 const touch=setupTouchControls({onJump:()=>{if(!keys.has('KeyE')&&!touch.input.slide)motion.jump();},onFirstTouch:()=>stepAudio.unlock()});
 if(embed)window.addEventListener('message',e=>{
  if(e.source!==parent||e.origin!==parentOrigin)return;
  if(e.data?.type==='antaris:touch-input'){
   touchExploring=e.data.active===true;
   const input=e.data.input;
   if(touchExploring&&input&&Number.isFinite(input.x)&&Number.isFinite(input.z)){
    touch.input.x=Math.max(-1,Math.min(1,input.x));touch.input.z=Math.max(-1,Math.min(1,input.z));touch.input.run=input.run===true;touch.input.slide=input.slide===true;
   }else touch.release();
  }
  if(e.data?.type==='antaris:touch-unlock')stepAudio.unlock();
  if(e.data?.type==='antaris:touch-jump'&&touchExploring)motion.jump();
 });
 const keyup=(event:KeyboardEvent)=>{keys.delete(event.code);};const clearKeys=()=>{keys.clear();slideTrail=null;stepAudio.stop();};
 window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',clearKeys);
 function stampFoot(x:number,z:number,yaw:number){
  const dirty=ground.footprints.stamp(x,z,yaw);if(!dirty)return;
  ground.applyRegion(dirty);counter.textContent=String(++footprintCount)+' pisadas · se borran en 14 s';
 }
 function move(dt:number){
  camera.getWorldDirection(forward);forward.y=0;forward.normalize();right.crossVectors(forward,up).normalize();
  const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+touch.input.x;
  const z=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))+touch.input.z;
  direction.copy(right).multiplyScalar(x).addScaledVector(forward,z);
  pushOut();
  const oldX=motion.x,oldZ=motion.z;
  motion.step(direction.x,direction.z,keys.has('ShiftLeft')||keys.has('ShiftRight')||touch.input.run,dt,(keys.has('KeyE')||touch.input.slide)&&!!swim);
  if(motion.sliding&&motion.moving){
   slideTrail??=new THREE.Vector2(oldX,oldZ);
   // Estela de nieve al deslizar sobre nieve blanda (más densa cuanto más rápido); en hielo, nada.
   if(terrain.isSoftSnow(motion.x,motion.z)){
    sprayDebt+=dt*(30+12*motion.slideSpeed);const count=Math.floor(sprayDebt);sprayDebt-=count;
    if(count>0)snowParticles.emit(motion.x,ground.height(motion.x,motion.z),motion.z,count,{dirX:motion.x-oldX,dirZ:motion.z-oldZ,back:.85,speed:[.4,.4+.25*motion.slideSpeed],up:[.4,1],size:[.02,.04],life:[.35,.7]});
   }
   // Update after 4 cm of travel, sweeping the entire interval without gaps. Ice keeps no groove.
   if(Math.hypot(motion.x-slideTrail.x,motion.z-slideTrail.y)>=.04){
    if(terrain.isSoftSnow(slideTrail.x,slideTrail.y)&&terrain.isSoftSnow(motion.x,motion.z)){
     const dirty=ground.footprints.groove(slideTrail.x,slideTrail.y,motion.x,motion.z);
     if(dirty)ground.applyRegion(dirty);
     counter.textContent='Surco en la nieve · se borra en 14 s';
    }else counter.textContent='Deslizando sobre hielo';
    slideTrail.set(motion.x,motion.z);
   }
  }else slideTrail=null;
  // Piso de la animación: los pies del GLB apoyan sobre este plano horizontal (en pendientes el pie de
  // abajo queda unos cm sobre la nieve; el contacto se mide contra este piso, la huella va al terreno).
  const animationFloor=ground.height(motion.x,motion.z)+motion.y;
  character.position.set(motion.x,animationFloor,motion.z);
  rotation.setFromAxisAngle(up,motion.yaw);character.quaternion.slerp(rotation,1-Math.exp(-20*dt));
  const state=motion.y>0?(motion.verticalSpeed>0?'saltando':'cayendo'):motion.sliding?'deslizándose':motion.skating&&motion.moving?'patinando':motion.running?'corriendo':motion.moving?'caminando':'en reposo';
  const groundSpeed=dt>0?Math.hypot(motion.x-oldX,motion.z-oldZ)/dt:0;
  // Patinando en hielo (de pie): con teclas, pasos de caminar o correr; planeando sin teclas, pose de reposo.
  const next=actions.get(motion.sliding?'swim':motion.skating?(motion.pushing?(motion.running?'run':'walk'):'idle'):motion.running?'run':motion.moving?'walk':'idle');
  if(next&&next!==active){
   const oldPhase=active&&active!==swim&&next!==swim&&active!==actions.get('idle')?active.time/active.getClip().duration:0;
   next.reset();if(next!==actions.get('idle'))next.time=oldPhase*next.getClip().duration;
   const transition=(next===swim||active===swim) ? .18 : .06;next.fadeIn(transition).play();active?.fadeOut(transition);active=next;
  }
  // Match backwards travel of the planted foot to actual forward travel of the body.
  // Deslizamiento: las aletas acompañan la velocidad (acelera en bajada).
  if(next===swim&&next)next.setEffectiveTimeScale(motion.moving?Math.min(2,.8*motion.slideSpeed/MOVE_SPEED.slide):0);
  // Patinando, los pies no van apoyados al ritmo del avance: pasos a ritmo fijo, algo vivo.
  else if(next&&motion.skating)next.setEffectiveTimeScale(motion.pushing?(motion.running?1.6:1.8):1);
  else if(next&&motion.moving)next.setEffectiveTimeScale(groundSpeed/(motion.running?GAIT_SPEED.run:GAIT_SPEED.walk));
  else if(next)next.setEffectiveTimeScale(1);
  if(animated||motion.moving||motion.sliding||motion.y>0||swim?.isScheduled())mixer.update(dt);
  character.position.y-=swimFloor*slideSupportWeight(swim);
  character.updateMatrixWorld(true);
  const airborne=motion.y>0||motion.verticalSpeed>0,landed=wasAirborne&&!airborne;
  for(const foot of feet){
   foot.bone.getWorldPosition(foot.point);
   const gap=foot.point.y-animationFloor;
   const contact=!motion.sliding&&!(slideSupportWeight(swim)>.01)&&!airborne&&gap<(foot.contact?.045:.028);
   const distance=foot.last.distanceTo(new THREE.Vector2(foot.point.x,foot.point.z));
   if(contact&&((!foot.contact&&motion.moving)||landed)&&distance>.12){
    // Huella solo en nieve blanda; en hielo se oye el paso pero no se marca.
    if(terrain.isSoftSnow(foot.point.x,foot.point.z)){
     stampFoot(foot.point.x,foot.point.z,character.rotation.y);
     // Granitos de nieve: hacia atrás y a los costados; más al correr y al aterrizar de un salto.
     snowParticles.emit(foot.point.x,ground.height(foot.point.x,foot.point.z),foot.point.z,landed?26:motion.running?13:8,
      landed?{speed:[.4,1.2],up:[.8,1.6],back:0}:{dirX:motion.x-oldX,dirZ:motion.z-oldZ,speed:motion.running?[.5,1.2]:[.25,.7],up:motion.running?[.7,1.4]:[.5,1.1]});
    }
    // Sobre hielo no suenan pisadas de nieve.
    if(terrain.ice(foot.point.x,foot.point.z)<.5)stepAudio.play(motion.running,landed,foot===feet[0]?-1:1);
    foot.last.set(foot.point.x,foot.point.z);
   }
   foot.contact=contact;
  }
  wasAirborne=airborne;
  if(state!==lastState){lastState=state;movementStatus.textContent='Pingüino '+state;}
 }
 /** La cámara acompaña al pingüino conservando el ángulo 3/4 (el usuario puede girarla y acercarla). */
 function followCamera(dt:number){
  follow.set(character.position.x,ground.height(character.position.x,character.position.z)+VIEW.lookHeight,character.position.z);
  const k=1-Math.exp(-9*dt),dx=(follow.x-controls.target.x)*k,dy=(follow.y-controls.target.y)*k,dz=(follow.z-controls.target.z)*k;
  controls.target.x+=dx;controls.target.y+=dy;controls.target.z+=dz;camera.position.x+=dx;camera.position.y+=dy;camera.position.z+=dz;
  controls.update();
  // Nunca bajo el relieve ni bajo el agua.
  const floor=Math.max(terrain.sample(camera.position.x,camera.position.z),terrain.seaY)+.7;
  if(camera.position.y<floor)camera.position.y=floor;
  // Niebla: se corre con la distancia de la cámara (de cerca, como antes: 38–120 m); de lejos la isla no se borra.
  const extra=Math.max(0,camera.position.distanceTo(controls.target)-24);fog.near=38+extra;fog.far=120+extra*1.5;
  // Sombra del pingüino: la cámara de sombras lo sigue.
  sun.target.position.copy(character.position);sun.position.copy(character.position).add(sunOffset);
 }
 const fog=scene.fog as THREE.Fog;
 let fadeElapsed=0,perfStarted=performance.now(),perfFrames=0;const perfLabel=document.getElementById('performance')!;
 const setup=performance.now()-started,timing=ground.timings;
 console.info(`${spec.name}: relieve ${timing.terrainMs.toFixed(0)} ms (erosión ${terrain.erosionMs.toFixed(0)} ms) · mapas ${timing.mapsMs.toFixed(0)} ms · texturas procedurales del material ${timing.materialMs.toFixed(0)} ms · malla ${timing.meshMs.toFixed(0)} ms · preparación total ${setup.toFixed(0)} ms · texturas KTX2 ${(textures.bytes/1024).toFixed(0)} KB`);
 // Solo en desarrollo: acceso para pruebas en el navegador (posición, uniforms, teclas simuladas).
 if(import.meta.env.DEV)Object.assign(window,{antarisLab:{motion,ground,terrain,camera,controls,character,keys,renderer,setup,spec,ocean:ground.ocean,structures}});
 if(import.meta.env.DEV)Object.defineProperty((window as unknown as {antarisLab:object}).antarisLab,"preloading",{get:()=>preloading});
 construction.patch(scene);
 // Dos variantes de cada material: la pantalla y el reflejo del agua (un render target: sin tone mapping ni sRGB).
 // Se compilan las dos ahora, en paralelo; si no, la del reflejo congelaba el primer cuadro (~3 s, medido).
 // las versiones simplificadas del reflejo están ocultas: se muestran solo para compilarlas con la variante del reflejo
 for(const o of structures)if(o.s.mirror)o.s.mirror.low.visible=true;
 const mirrorProbe=new THREE.WebGLRenderTarget(1,1);renderer.setRenderTarget(mirrorProbe);
 const compileMirror=renderer.compileAsync(scene,camera);renderer.setRenderTarget(null);
 for(const o of structures)if(o.s.mirror)o.s.mirror.low.visible=false;
 await Promise.all([compileMirror,renderer.compileAsync(scene,camera)]).catch(()=>{});
 // Primer dibujo fuera de pantalla (todo descartado por el revelado): sube texturas y geometría y arma la sombra y el
 // reflejo (~0,35 s, medido) con la malla todavía en pantalla. Si no, ese tirón caía en el primer cuadro del revelado.
 renderer.setRenderTarget(mirrorProbe);renderer.render(scene,camera);renderer.setRenderTarget(null);mirrorProbe.dispose();await nextFrame();
 const clock=new THREE.Clock();const resize=()=>{fitCamera();renderer.setSize(innerWidth,innerHeight);snowParticles.setViewport(renderer.domElement.height,camera.fov);};window.addEventListener('resize',resize);
 let simTime=0;
 function tick(dt:number){
  simTime+=dt;
  fadeElapsed+=dt;if(fadeElapsed>=.1){const remaining=ground.fade(fadeElapsed);fadeElapsed=0;if(!remaining&&footprintCount>0){footprintCount=0;counter.textContent='Nieve sin huellas';}}
  move(dt);followCamera(dt);updateStations();updateProximity();snowParticles.update(dt,(x,z)=>ground.height(x,z));ground.update(simTime);for(const o of structures)o.s.update(simTime);ground.flush(renderer);renderer.render(scene,camera);
 }
 if(import.meta.env.DEV)Object.assign((window as unknown as {antarisLab:object}).antarisLab,{tick,scene});
 renderer.setAnimationLoop(()=>{const dt=Math.min(clock.getDelta(),.05);if(document.hidden||embedPausado)return;
 tick(dt);
 perfFrames++;const elapsed=performance.now()-perfStarted;if(elapsed>=2000){perfLabel.textContent=Math.round(perfFrames*1000/elapsed)+' FPS · '+renderer.info.render.triangles.toLocaleString('es-AR')+' triángulos · '+renderer.info.render.calls+' llamadas · huellas CPU '+(ground.cpuMs/perfFrames).toFixed(2)+' ms/cuadro';perfStarted=performance.now();perfFrames=0;ground.cpuMs=0;}});status.hidden=true;
 construction.finish(scene,()=>{}).then(()=>{preloading=false;});
 window.addEventListener('pagehide',()=>{if(disposed)return;disposed=true;for(const edges of outlines.values())for(const line of edges){line.geometry.dispose();(line.material as THREE.Material).dispose();}stepAudio.dispose();renderer.domElement.removeEventListener('pointerdown',unlockAudio);renderer.setAnimationLoop(null);window.removeEventListener('resize',resize);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',clearKeys);document.removeEventListener('visibilitychange',clearKeys);controls.dispose();mixer.stopAllAction();mixer.uncacheRoot(penguin);const materials=new Set<THREE.Material>(),textureSet=new Set<THREE.Texture>();scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});for(const m of materials){for(const value of Object.values(m))if(value instanceof THREE.Texture)textureSet.add(value);m.dispose();}for(const u of Object.values(ground.uniforms))if(u.value instanceof THREE.Texture)textureSet.add(u.value);for(const t of textureSet)t.dispose();snowParticles.dispose();sun.shadow.map?.dispose();renderer.dispose();},{once:true});
}
main().catch(error=>{status.hidden=false;status.textContent='No se pudo preparar la prueba: '+String(error);console.error(error);});
