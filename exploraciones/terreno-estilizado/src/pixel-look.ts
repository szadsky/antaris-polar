import * as THREE from 'three';

/** Pixel quantisation and Bayer dithering adapted from Noxe Pixel Engine (MIT).
 * Copyright (c) 2026 Daniel Jankulovski. See vendor/noxe/LICENSE.
 * Adaptation: existing perspective camera/materials, one low-resolution scene target,
 * existing Three.js tone mapping, no normal pass, outlines, bloom or sky replacement.
 */
export function createPixelLook(renderer: THREE.WebGLRenderer) {
  let enabled=false,pixelSize=4,target:THREE.WebGLRenderTarget|null=null;
  const size=new THREE.Vector2();
  const uniforms={tColor:{value:null as THREE.Texture|null},uLow:{value:new THREE.Vector2()},uPixel:{value:4},uLevels:{value:14},uDither:{value:.45}};
  const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:true,
    vertexShader:`void main(){gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      uniform sampler2D tColor;
      uniform vec2 uLow;
      uniform float uPixel,uLevels,uDither;
      float bayer(ivec2 p){
        const float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        return (m[(p.y & 3)*4+(p.x & 3)]+.5)/16.;
      }
      void main(){
        ivec2 p=min(ivec2(floor(gl_FragCoord.xy/uPixel)),ivec2(uLow)-1);
        gl_FragColor=vec4(texelFetch(tColor,p,0).rgb,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 c=gl_FragColor.rgb;
        float l=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(l),c,1.08);
        c=clamp((c-.5)*1.04+.5,0.,1.);
        float L=max(uLevels-1.,1.);
        c=floor(c*L+.5+(bayer(p)-.5)*uDither)/L;
        gl_FragColor=vec4(clamp(c,0.,1.),1.);
      }`});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;
  const scene=new THREE.Scene();scene.add(quad);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  function release(){uniforms.tColor.value=null;target?.dispose();target=null;}
  return {
    setEnabled(value:boolean){enabled=value;if(!value)release();},
    setSize(value:number){pixelSize=THREE.MathUtils.clamp(Math.round(value),2,8);},
    setLevels(value:number){uniforms.uLevels.value=THREE.MathUtils.clamp(Math.round(value),4,32);},
    setDither(value:number){uniforms.uDither.value=THREE.MathUtils.clamp(value,0,1);},
    render(world:THREE.Scene,view:THREE.Camera){
      if(!enabled){renderer.render(world,view);return;}
      renderer.getDrawingBufferSize(size);
      const block=Math.max(1,Math.round(pixelSize*renderer.getPixelRatio()));
      const w=Math.max(1,Math.ceil(size.x/block)),h=Math.max(1,Math.ceil(size.y/block));
      if(!target)target=new THREE.WebGLRenderTarget(w,h,{type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,depthBuffer:true});
      if(target.width!==w||target.height!==h)target.setSize(w,h);
      uniforms.tColor.value=target.texture;uniforms.uLow.value.set(w,h);uniforms.uPixel.value=block;
      const oldTarget=renderer.getRenderTarget(),auto=renderer.autoClear;
      try{
        renderer.autoClear=true;renderer.setRenderTarget(target);renderer.render(world,view);
        renderer.setRenderTarget(oldTarget);renderer.render(scene,camera);
      }finally{renderer.setRenderTarget(oldTarget);renderer.autoClear=auto;}
    },
    dispose(){release();quad.geometry.dispose();material.dispose();}
  };
}
