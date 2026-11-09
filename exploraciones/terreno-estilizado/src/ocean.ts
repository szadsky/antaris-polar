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
    textureWidth:192,textureHeight:192,waterNormals:rippleMap(),waterColor:0x103a42,
    sunColor:0xd9eafa,sunDirection:sun,distortionScale:1.5,clipBias:0.0001,fog:true,
  });
  mesh.rotation.x=-Math.PI/2;
  mesh.name="océano";
  const mat=mesh.material,u=mat.uniforms;
  mat.transparent=false;mat.depthWrite=true;
  // Give solid terrain priority on equal depth samples at grazing angles.
  mat.polygonOffset=true;mat.polygonOffsetFactor=1;mat.polygonOffsetUnits=1;
  Object.assign(u,{shoreLight:{value:null},waterExtent:{value:new THREE.Vector2(1,1)},
    mirrorEnabled:{value:0},shoreReady:{value:0}});
  const officialFragment=mat.fragmentShader;
  const lightweightFragment=officialFragment.replace("uniform float alpha;",`
    uniform float alpha,mirrorEnabled,shoreReady;
    uniform vec2 waterExtent;
    uniform sampler2D shoreLight;
  `).replace(/vec4 noise = getNoise[\s\S]*?vec3 outgoingLight = albedo;/,`
    vec2 p=worldPosition.xz;
    vec2 coarse=texture2D(normalSampler,p/88.0+time*vec2(.009,.003)).rg*2.0-1.0;
    vec2 micro=texture2D(normalSampler,p/17.0+time*vec2(-.012,.006)).rg*2.0-1.0;
    float pixel=max(length(dFdx(p)),length(dFdy(p)));
    float fine=1.0-smoothstep(.45,2.3,pixel);
    vec2 slope=coarse*.18+micro*(.075*fine);
    vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
    vec3 viewDir=normalize(cameraPosition-worldPosition.xyz);
    vec3 r=reflect(-viewDir,n);
    vec3 sky=mix(vec3(.26,.38,.46),vec3(.10,.20,.29),smoothstep(0.,.9,r.y));
    vec3 reflected=sky;
    if(mirrorEnabled>.5 && mirrorCoord.w>0.) {
      vec2 uv=mirrorCoord.xy/mirrorCoord.w+slope*.014;
      vec2 edge=min(uv,1.-uv);
      reflected=mix(sky,texture2D(mirrorSampler,clamp(uv,.002,.998)).rgb,
                    .82*smoothstep(.002,.04,min(edge.x,edge.y)));
    }
    float fresnel=.035+.70*pow(1.-clamp(dot(viewDir,n),0.,1.),4.);
    float spec=pow(max(0.,dot(n,normalize(sunDirection+viewDir))),mix(42.,100.,fine));
    vec3 outgoingLight=mix(waterColor*(.68+.32*max(n.y,0.)),reflected,fresnel)+sunColor*spec*.23;
    vec2 shoreUV=p/waterExtent+.5;
    if(shoreReady>.5 && all(greaterThan(shoreUV,vec2(0.))) && all(lessThan(shoreUV,vec2(1.)))) {
      float proximity=texture2D(shoreLight,shoreUV).g;
      float foam=smoothstep(.957,.997,proximity)*smoothstep(.05,.32,coarse.x+micro.y*.2)*fine;
      outgoingLight=mix(outgoingLight,vec3(.58,.70,.73),foam*.11);
    }
  `);
  // A reflection only needs the silhouette and broad snow/rock tones.
  const reflectionScene=new THREE.Scene();
  const reflectedSky=new THREE.Color();
  const proxy=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshBasicMaterial({vertexColors:true}));
  reflectionScene.add(proxy);
  let current:Terrain|undefined;
  function buildProxy(t:Terrain) {
    const {width,height,cellSizeM}=t.level;
    const endX=(t.meshSize.width-1)*2,endZ=(t.meshSize.height-1)*2;
    const segments=Math.min(128,endX,endZ);
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
    if(!high || !current)return;
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
    high=!mobile && t==="alta";
    const fragment=high ? officialFragment : lightweightFragment;
    if(mat.fragmentShader!==fragment){mat.fragmentShader=fragment;mat.needsUpdate=true;}
    u.mirrorEnabled.value=0;
    dirty=true;
  }
  quality(initial);
  return {mesh,quality,refresh:()=>{dirty=true;},time:(t:number)=>{u.time.value=t*.75;},
    bind(t:Terrain){current=t;u.shoreLight.value=t.styleUniforms.uLight.value;
      // Texture samples are at grid centres, first and last half a texel inward.
      u.waterExtent.value.set(t.widthM*t.meshSize.width/(t.meshSize.width-1),t.depthM*t.meshSize.height/(t.meshSize.height-1));
      u.shoreReady.value=1;dirty=true;}
  };
}

