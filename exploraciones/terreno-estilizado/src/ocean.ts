import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import type { Terrain } from "./terrain";
import type { Tier } from "./quality";

import normalUrl from "./waternormals.jpg";

function rippleMap() {
  const tex=new THREE.TextureLoader().load(normalUrl);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.colorSpace=THREE.NoColorSpace;
  return tex;
}
export function createOcean(size:number,sun:THREE.Vector3,mobile:boolean,initial:Tier) {
  const mesh=new Water(new THREE.PlaneGeometry(size*8,size*8),{
    textureWidth:mobile?96:192,textureHeight:mobile?96:192,waterNormals:rippleMap(),waterColor:0x103a42,
    sunColor:0xd9eafa,sunDirection:sun,distortionScale:1.5,clipBias:0.0001,fog:true,
  });
  mesh.rotation.x=-Math.PI/2;
  mesh.name="océano";
  const mat=mesh.material,u=mat.uniforms;
  mat.transparent=false;mat.depthWrite=true;
  // Give solid terrain priority on equal depth samples at grazing angles.
  mat.polygonOffset=true;mat.polygonOffsetFactor=1;mat.polygonOffsetUnits=1;
  const officialFragment=mat.fragmentShader;
  const mobileFragment=officialFragment.replace(/vec4 getNoise\( vec2 uv \) \{[\s\S]*?\}/,`
    vec4 getNoise(vec2 uv) {
      vec4 swell=texture2D(normalSampler,uv/103.0+vec2(time/17.0,time/29.0));
      vec4 ripple=texture2D(normalSampler,uv/34.0+vec2(-time/31.0,time/37.0));
      return (swell*.65+ripple*.35)*2.0-1.0;
    }
  `);
  const skyFragment=mobileFragment.replace(/vec3 reflectionSample = [^;]+;/,
    "vec3 reflectionSample=mix(vec3(.24,.36,.44),vec3(.085,.16,.22),clamp(reflect(-eyeDirection,surfaceNormal).y,0.,1.));");  // A reflection only needs the silhouette and broad snow/rock tones.
  const reflectionScene=new THREE.Scene();
  const reflectedSky=new THREE.Color();
  const proxy=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({vertexColors:true}));
  reflectionScene.add(proxy);
  let current:Terrain|undefined;
  function buildProxy(t:Terrain) {
    const {width,height,cellSizeM}=t.level;
    const endX=(t.meshSize.width-1)*2,endZ=(t.meshSize.height-1)*2;
    const segments=Math.min(mobile?32:128,endX,endZ);
    const grid=new THREE.PlaneGeometry(t.widthM,t.depthM,segments,segments).rotateX(-Math.PI/2);
    const positions=grid.getAttribute("position");
    const colors=new Float32Array(positions.count*3);
    const rock=new THREE.Color(0x657078),snow=new THREE.Color(0xe1eaf0);
    const shade=new THREE.Color(),sea=t.seaLevelM??0;
    const h=(x:number,z:number)=>{const v=t.heightsM[z*width+x];return Number.isFinite(v)?v:sea-1;};
    for(let z=0;z<=segments;z++)for(let x=0;x<=segments;x++){
      const i=z*(segments+1)+x,ix=Math.round(x*endX/segments),iz=Math.round(z*endZ/segments);
      const dx=(h(Math.min(width-1,ix+2),iz)-h(Math.max(0,ix-2),iz))/(4*cellSizeM);
      const dz=(h(ix,Math.min(height-1,iz+2))-h(ix,Math.max(0,iz-2)))/(4*cellSizeM);
      positions.setY(i,h(ix,iz));
      shade.copy(snow).lerp(rock,THREE.MathUtils.smoothstep(Math.hypot(dx,dz),.6,1.6))
        .multiplyScalar(.68+.32*Math.max(0,(sun.y-sun.x*dx-sun.z*dz)/Math.hypot(dx,1,dz)));
      shade.toArray(colors,i*3);
    }
    grid.setAttribute("color",new THREE.BufferAttribute(colors,3));
    proxy.geometry.dispose();proxy.geometry=grid;
  }
  const mirror=mesh.onBeforeRender;
  let high=false,dirty=true,prepared:Terrain|undefined;
  const world=new THREE.Matrix4(),projection=new THREE.Matrix4();
  mesh.onBeforeRender=(renderer,scene,camera,geometry,material,group)=>{
    if(!high){u.eye.value.setFromMatrixPosition(camera.matrixWorld);return;}
    if(!current)return;
    if(!dirty && world.equals(camera.matrixWorld)&&projection.equals(camera.projectionMatrix))return;
    if(prepared!==current){buildProxy(current);prepared=current;}
    const object=current.object;
    // Full mesh scales vertically; the chunked path stores exaggeration in its height uniform.
    proxy.scale.y=current.styleUniforms.uSeaY.value && current.seaLevelM
      ? current.styleUniforms.uSeaY.value/current.seaLevelM : (object.children.find(o=>o.scale.y!==1)?.scale.y??object.scale.y);
    reflectionScene.background=scene.background instanceof THREE.Color
      ? reflectedSky.copy(scene.background).multiplyScalar(.67) : scene.background;
    reflectionScene.fog=scene.fog;
    mirror.call(mesh,renderer,reflectionScene,camera,geometry,material,group);
    world.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);dirty=false;
  };
  function quality(t:Tier) {
    high=t==="alta" || (mobile && t==="media");
    const fragment=high ? (mobile ? mobileFragment : officialFragment) : skyFragment;
    if(mat.fragmentShader!==fragment){mat.fragmentShader=fragment;mat.needsUpdate=true;}

    dirty=true;
  }
  quality(initial);
  return {mesh,quality,refresh:()=>{dirty=true;},time:(t:number)=>{u.time.value=t*.75;},
    bind(t:Terrain){current=t;dirty=true;}
  };
}
