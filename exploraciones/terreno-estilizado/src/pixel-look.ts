import * as THREE from 'three';

/** Pixel quantisation and Bayer dithering adapted from Noxe Pixel Engine (MIT).
 * Copyright (c) 2026 Daniel Jankulovski. See vendor/noxe/LICENSE.
 * Adaptation: existing perspective camera/materials, one low-resolution scene target,
 * existing Three.js tone mapping, no normal pass or bloom. Depth-based outlines read the depth
 * of the same low-resolution target (no extra scene pass).
 */
export type PixelPattern = 'bayer2' | 'bayer4' | 'bayer8' | 'none';
export type PixelPalette = 'libre' | 'gris' | 'hielo' | 'calido';
export interface PixelParams {
  /** Tamaño del bloque en píxeles CSS (1 = sin pixelar, solo color). */
  size: number;
  /** Niveles por canal (o por rampa en las paletas). */
  levels: number;
  /** Intensidad del tramado (0–1). */
  dither: number;
  pattern: PixelPattern;
  palette: PixelPalette;
  /** Saturación (1 = sin cambio). */
  saturation: number;
  /** Contraste (1 = sin cambio). */
  contrast: number;
  /** Brillo, suma en sRGB (−0,3…0,3). */
  brightness: number;
  /** Contornos por profundidad: 0 = apagados, 1 = negro pleno. */
  outline: number;
  /** Salto relativo de profundidad que cuenta como borde (0,005 = 0,5 %). */
  outlineThreshold: number;
}
// Los valores por defecto reproducen el efecto anterior (saturación 1,08 y contraste 1,04 eran fijos).
export const PIXEL_DEFAULTS: PixelParams = { size: 4, levels: 14, dither: .45, pattern: 'bayer4', palette: 'libre', saturation: 1.08, contrast: 1.04, brightness: 0, outline: 0, outlineThreshold: .02 };
const PATTERN_ID: Record<PixelPattern, number> = { none: 0, bayer2: 2, bayer4: 4, bayer8: 8 };
const PALETTE_ID: Record<PixelPalette, number> = { libre: 0, gris: 1, hielo: 2, calido: 3 };

export function createPixelLook(renderer: THREE.WebGLRenderer) {
  let enabled=false,target:THREE.WebGLRenderTarget|null=null;
  const p:PixelParams={...PIXEL_DEFAULTS};
  const size=new THREE.Vector2();
  const uniforms={tColor:{value:null as THREE.Texture|null},tDepth:{value:null as THREE.Texture|null},uLow:{value:new THREE.Vector2()},uPixel:{value:4},
    uLevels:{value:p.levels},uDither:{value:p.dither},uPattern:{value:4},uPalette:{value:0},uSat:{value:p.saturation},uContrast:{value:p.contrast},
    uBright:{value:p.brightness},uOutline:{value:p.outline},uOutlineThr:{value:p.outlineThreshold},uNear:{value:1},uFar:{value:1000}};
  const material=new THREE.ShaderMaterial({uniforms,depthTest:false,depthWrite:false,toneMapped:true,
    vertexShader:`void main(){gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      #include <packing>
      uniform sampler2D tColor,tDepth;
      uniform vec2 uLow;
      uniform float uPixel,uLevels,uDither,uPattern,uPalette,uSat,uContrast,uBright,uOutline,uOutlineThr,uNear,uFar;
      // Matrices de Bayer 2×2, 4×4 y 8×8 (umbral 0–1)
      float bayer2(ivec2 p){ return float(((p.x&1)^(p.y&1))*2+(p.y&1))*.25+.125; }
      float bayer4(ivec2 p){
        const float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
        return (m[(p.y & 3)*4+(p.x & 3)]+.5)/16.;
      }
      float bayer8(ivec2 p){ // recursiva: 4 × bayer4 + bayer2 del bloque
        return (floor(bayer4(p>>1)*16.)*4.+floor(bayer2(p)*4.)+.5)/64.;
      }
      float pattern(ivec2 p){
        return uPattern<1.?.5:uPattern<3.?bayer2(p):uPattern<5.?bayer4(p):bayer8(p);
      }
      float viewDepth(ivec2 q){
        q=clamp(q,ivec2(0),ivec2(uLow)-1);
        return -perspectiveDepthToViewZ(texelFetch(tDepth,q,0).r,uNear,uFar);
      }
      // Rampas de color de las paletas (sRGB), interpoladas por luminancia y cuantizadas a uLevels pasos.
      vec3 ramp(float t){
        if(uPalette<1.5) return vec3(t);
        if(uPalette<2.5){ // hielo: azul noche → turquesa → blanco frío
          vec3 a=vec3(.04,.07,.14),b=vec3(.16,.42,.55),c=vec3(.62,.80,.88),d=vec3(.97,.99,1.);
          return t<.33?mix(a,b,t/.33):t<.7?mix(b,c,(t-.33)/.37):mix(c,d,(t-.7)/.3);
        }
        // cálido: violeta → terracota → arena → crema
        vec3 a=vec3(.12,.07,.16),b=vec3(.55,.27,.22),c=vec3(.88,.66,.42),d=vec3(1.,.95,.84);
        return t<.33?mix(a,b,t/.33):t<.7?mix(b,c,(t-.33)/.37):mix(c,d,(t-.7)/.3);
      }
      void main(){
        ivec2 p=min(ivec2(floor(gl_FragCoord.xy/uPixel)),ivec2(uLow)-1);
        gl_FragColor=vec4(texelFetch(tColor,p,0).rgb,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 c=gl_FragColor.rgb;
        c+=uBright;
        float l=dot(c,vec3(.2126,.7152,.0722));
        c=mix(vec3(l),c,uSat);
        c=clamp((c-.5)*uContrast+.5,0.,1.);
        float L=max(uLevels-1.,1.);
        float d=(pattern(p)-.5)*uDither;
        if(uPalette<.5) c=floor(c*L+.5+d)/L;
        else c=ramp(clamp(floor(dot(c,vec3(.2126,.7152,.0722))*L+.5+d)/L,0.,1.));
        // Contornos: el píxel cercano junto a uno bastante más lejos (salto relativo de profundidad) se oscurece.
        if(uOutline>0.){
          float z=viewDepth(p);
          float zf=max(max(viewDepth(p+ivec2(1,0)),viewDepth(p-ivec2(1,0))),max(viewDepth(p+ivec2(0,1)),viewDepth(p-ivec2(0,1))));
          float edge=smoothstep(uOutlineThr,uOutlineThr*2.,(zf-z)/max(z,1e-3));
          c*=1.-uOutline*edge;
        }
        gl_FragColor=vec4(clamp(c,0.,1.),1.);
      }`});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);quad.frustumCulled=false;
  const scene=new THREE.Scene();scene.add(quad);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  function release(){uniforms.tColor.value=null;uniforms.tDepth.value=null;target?.depthTexture?.dispose();target?.dispose();target=null;}
  function apply(){
    uniforms.uLevels.value=p.levels;uniforms.uDither.value=p.dither;uniforms.uPattern.value=PATTERN_ID[p.pattern];
    uniforms.uPalette.value=PALETTE_ID[p.palette];uniforms.uSat.value=p.saturation;uniforms.uContrast.value=p.contrast;
    uniforms.uBright.value=p.brightness;uniforms.uOutline.value=p.outline;uniforms.uOutlineThr.value=p.outlineThreshold;
  }
  const clamp=THREE.MathUtils.clamp;
  return {
    get params(){return {...p};},
    setEnabled(value:boolean){enabled=value;if(!value)release();},
    /** Cambia un parámetro (con sus límites). */
    set<K extends keyof PixelParams>(key:K,value:PixelParams[K]){
      const v=value as unknown;
      switch(key){
        case 'size':p.size=clamp(Math.round(v as number),1,16);break;
        case 'levels':p.levels=clamp(Math.round(v as number),2,32);break;
        case 'dither':p.dither=clamp(v as number,0,1);break;
        case 'saturation':p.saturation=clamp(v as number,0,2);break;
        case 'contrast':p.contrast=clamp(v as number,.5,2);break;
        case 'brightness':p.brightness=clamp(v as number,-.3,.3);break;
        case 'outline':p.outline=clamp(v as number,0,1);break;
        case 'outlineThreshold':p.outlineThreshold=clamp(v as number,.002,.2);break;
        case 'pattern':if((v as string) in PATTERN_ID)p.pattern=v as PixelPattern;break;
        case 'palette':if((v as string) in PALETTE_ID)p.palette=v as PixelPalette;break;
      }
      apply();
    },
    // compatibilidad con los controles anteriores
    setSize(value:number){this.set('size',value);},
    setLevels(value:number){this.set('levels',value);},
    setDither(value:number){this.set('dither',value);},
    render(world:THREE.Scene,view:THREE.Camera){
      if(!enabled){renderer.render(world,view);return;}
      renderer.getDrawingBufferSize(size);
      const block=Math.max(1,Math.round(p.size*renderer.getPixelRatio()));
      const w=Math.max(1,Math.ceil(size.x/block)),h=Math.max(1,Math.ceil(size.y/block));
      if(!target){
        target=new THREE.WebGLRenderTarget(w,h,{type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,generateMipmaps:false,depthBuffer:true});
        // profundidad de la misma pasada, para los contornos (sin otra pasada de escena)
        target.depthTexture=new THREE.DepthTexture(w,h,THREE.UnsignedIntType);
      }
      if(target.width!==w||target.height!==h)target.setSize(w,h);
      uniforms.tColor.value=target.texture;uniforms.tDepth.value=target.depthTexture;uniforms.uLow.value.set(w,h);uniforms.uPixel.value=block;
      if(view instanceof THREE.PerspectiveCamera){uniforms.uNear.value=view.near;uniforms.uFar.value=view.far;}
      const oldTarget=renderer.getRenderTarget(),auto=renderer.autoClear;
      try{
        renderer.autoClear=true;renderer.setRenderTarget(target);renderer.render(world,view);
        renderer.setRenderTarget(oldTarget);renderer.render(scene,camera);
      }finally{renderer.setRenderTarget(oldTarget);renderer.autoClear=auto;}
    },
    dispose(){release();quad.geometry.dispose();material.dispose();}
  };
}
