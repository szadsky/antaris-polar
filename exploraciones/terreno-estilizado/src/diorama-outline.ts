import * as THREE from 'three';
/** Combined diorama silhouette against the background, preserving terrain displacement. */
export function createDioramaOutline(renderer:THREE.WebGLRenderer){
 let enabled=true,root:THREE.Object3D|null=null,width=1;
 let silhouetteRoots:THREE.Object3D[]=[];
 let target:THREE.WebGLRenderTarget|null=null;
 const masks=new Map<THREE.Material,THREE.Material>(),blockers=new Map<number,THREE.MeshBasicMaterial>();
 const size=new THREE.Vector2(),overlayScene=new THREE.Scene(),overlayCamera=new THREE.Camera();
 const overlayMaterial=new THREE.ShaderMaterial({
  uniforms:{mask:{value:null},texel:{value:new THREE.Vector2()},ink:{value:new THREE.Color(0x344e60)},strength:{value:.65}},
  vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
  fragmentShader:`uniform sampler2D mask; uniform vec2 texel; uniform vec3 ink; uniform float strength; varying vec2 vUv;
  void main(){float center=texture2D(mask,vUv).r;float low=center;
   for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++)low=min(low,texture2D(mask,vUv+vec2(float(x),float(y))*texel).r);
   gl_FragColor=vec4(ink,clamp(center-low,0.0,1.0)*strength);
   #include <colorspace_fragment>
  }`,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
 const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),overlayMaterial);quad.frustumCulled=false;overlayScene.add(quad);
 function clearMasks(){for(const m of masks.values())m.dispose();masks.clear();}
 function maskMaterial(source:THREE.Material){
  let material=masks.get(source);if(material)return material;
  material=source.clone();material.onBeforeCompile=(shader,r)=>{
   source.onBeforeCompile(shader,r);
   shader.fragmentShader=`#include <common>
    #include <clipping_planes_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    void main(){
     #include <clipping_planes_fragment>
     #include <logdepthbuf_fragment>
     gl_FragColor=vec4(1.0);
    }`;
  };
  material.customProgramCacheKey=()=>source.customProgramCacheKey()+'-terrain-silhouette';
  material.transparent=false;material.blending=THREE.NoBlending;material.depthWrite=true;material.toneMapped=false;
  masks.set(source,material);return material;
 }
 function blocker(source:THREE.Material){
  let material=blockers.get(source.side);if(!material){material=new THREE.MeshBasicMaterial({color:0xffffff,side:source.side,toneMapped:false,fog:false});blockers.set(source.side,material);}return material;
 }
 return {
  bind(terrain:THREE.Object3D,objects:THREE.Object3D[]){root=terrain;silhouetteRoots=objects;clearMasks();},
  setEnabled(value:boolean){enabled=value;if(!value){target?.dispose();target=null;clearMasks();}},
  setWidth(value:number){width=THREE.MathUtils.clamp(value,.5,3);},
  setStrength(value:number){overlayMaterial.uniforms.strength.value=THREE.MathUtils.clamp(value,0,1);},
  setColor(value:string){overlayMaterial.uniforms.ink.value.set(value);},
  render(scene:THREE.Scene,camera:THREE.Camera){
   renderer.render(scene,camera);
   if(!enabled||!root)return;
   renderer.getDrawingBufferSize(size);
   if(!target){target=new THREE.WebGLRenderTarget(size.x,size.y,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});target.samples=Math.min(2,renderer.capabilities.maxSamples);}
   if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);
   const terrain=new Set<THREE.Object3D>();root.traverse(o=>terrain.add(o));
   const silhouette=new Set<THREE.Object3D>();for(const object of silhouetteRoots)object.traverse(o=>silhouette.add(o));
   const excluded:THREE.Object3D[]=[];
   const saved:{mesh:THREE.Mesh;material:THREE.Material|THREE.Material[];before:THREE.Mesh['onBeforeRender'];after:THREE.Mesh['onAfterRender']}[]=[];
   const background=scene.background,override=scene.overrideMaterial,oldTarget=renderer.getRenderTarget();
   const clearColor=renderer.getClearColor(new THREE.Color()),clearAlpha=renderer.getClearAlpha(),auto=renderer.autoClear,shadow=renderer.shadowMap.autoUpdate;
   try{
    scene.traverseVisible(o=>{if(!(o instanceof THREE.Mesh))return;
     if(!silhouette.has(o)){excluded.push(o);return;}
     saved.push({mesh:o,material:o.material,before:o.onBeforeRender,after:o.onAfterRender});
     const select=terrain.has(o)?maskMaterial:blocker;
     o.material=Array.isArray(o.material)?o.material.map(select):select(o.material);
     // All diorama surfaces share one white mask: no shoreline or object boundaries.
     // Do not trigger water reflections in the silhouette pass.
     o.onBeforeRender=()=>{};o.onAfterRender=()=>{};
    });
    for(const o of excluded)o.visible=false;
    scene.background=null;scene.overrideMaterial=null;renderer.shadowMap.autoUpdate=false;renderer.autoClear=true;
    renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.render(scene,camera);
   }finally{
    for(const o of excluded)o.visible=true;
    for(const s of saved){s.mesh.material=s.material;s.mesh.onBeforeRender=s.before;s.mesh.onAfterRender=s.after;}
    scene.background=background;scene.overrideMaterial=override;renderer.shadowMap.autoUpdate=shadow;
    renderer.setRenderTarget(oldTarget);renderer.setClearColor(clearColor,clearAlpha);renderer.autoClear=auto;
   }
   overlayMaterial.uniforms.mask.value=target.texture;
   overlayMaterial.uniforms.texel.value.set(width*renderer.getPixelRatio()/size.x,width*renderer.getPixelRatio()/size.y);
   renderer.autoClear=false;
   try{renderer.render(overlayScene,overlayCamera);}finally{renderer.autoClear=auto;}
  },
  dispose(){clearMasks();for(const m of blockers.values())m.dispose();target?.dispose();quad.geometry.dispose();overlayMaterial.dispose();}
 };
}
