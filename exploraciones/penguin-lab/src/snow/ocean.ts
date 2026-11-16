import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";

import normalUrl from "./waternormals.jpg";

/**
 * Agua del visor de bases (terreno-estilizado/src/ocean.ts, 14/11/2026) llevada a la escala de la isla del pingüino:
 * el mismo Water de three con reflejo planar, oleaje sedoso estocástico, color según la distancia a la costa, tinte
 * claro de orilla, espuma pegada a la costa y reflejo del sol en tres lóbulos. Mismos valores que en el visor.
 *
 * Escala: el visor mira el agua desde 1–3 km y la isla desde ~15 m. `scale` (m del visor por m de la isla) achica
 * las ondas, la espuma, las distancias a la costa y la deformación del reflejo en la misma proporción: se ve el mismo
 * agua, no un espejo con ondas de 500 m. Sin cubemap precalculado (en la isla el reflejo planar es barato).
 * Reconstrucción artística: no son olas ni batimetría medidas.
 */
function rippleMap(maxAniso: number) {
  const tex = new THREE.TextureLoader().load(normalUrl);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.anisotropy = Math.min(4, maxAniso);
  return tex;
}
// Color del agua profunda vista desde arriba (lo que se ve a través de la superficie con poco reflejo).
const WATER_COLOR = 0x103a42;
// Color propio del agua poco profunda junto a la costa (turquesa claro): color según la profundidad.
const SHALLOW_COLOR = 0x2f8f95;
// Reflejo planar con la cámara en movimiento: uno de cada N cuadros (1 = todos), como en el visor.
const MIRROR_EVERY = 2;
/** Alcances (m del visor) de la cercanía a la costa: tinte de orilla (canal G) y color por profundidad (canal A). */
export const SHORE_M = 160, FAR_SHORE_M = 1500;

export interface OceanShore {
  /** RGBA8: G = cercanía a la costa (1 en la costa → 0 a SHORE_M / scale m) · A = ídem de largo alcance (FAR_SHORE_M). */
  shore: THREE.Texture;
  /** Lado (m) del cuadrado centrado en el origen que cubre `shore`. */
  shoreCrop: number;
  /** R8: distancia con signo a la costa en m del visor (· 8 + 128, ±16 m), para la espuma. */
  foam: THREE.Texture;
  foamCrop: number;
}

export function createOcean(o: { radius: number; sun: THREE.Vector3; mobile: boolean; maxAniso: number; scale: number; shore: OceanShore;
  /** Objetos que se cambian solo durante el dibujo del reflejo (p. ej., una versión más liviana del terreno). */
  mirrorSwap?: { hide: THREE.Object3D[]; show: THREE.Object3D[] } }) {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const longest = o.mobile ? 384 : 512;
  const reflectionWidth = Math.max(128, Math.round(longest * Math.min(1, aspect)));
  const reflectionHeight = Math.max(128, Math.round(longest * Math.min(1, 1 / aspect)));
  const mesh = new Water(new THREE.CircleGeometry(o.radius, 96), {
    textureWidth: reflectionWidth, textureHeight: reflectionHeight, waterNormals: rippleMap(o.maxAniso), waterColor: WATER_COLOR,
    sunColor: 0xd9eafa, sunDirection: o.sun.clone().normalize(), distortionScale: 1.4, clipBias: 0.0001, fog: true,
  });
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = "agua";
  const mat = mesh.material, u = mat.uniforms;
  u.size.value = o.scale; // ondas: getNoise(worldPosition.xz * size), en m del visor
  u.uScale = { value: o.scale };
  u.uBergRipples = { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1)) };
  const reflection = u.mirrorSampler.value as THREE.Texture; reflection.generateMipmaps = true; reflection.minFilter = THREE.LinearMipmapLinearFilter; reflection.magFilter = THREE.LinearFilter;
  u.uShore = { value: o.shore.shore };
  u.uCrop = { value: new THREE.Vector2(o.shore.shoreCrop, o.shore.shoreCrop) };
  u.uSurf = { value: o.shore.foam };
  u.uSurfCrop = { value: new THREE.Vector2(o.shore.foamCrop, o.shore.foamCrop) };
  u.uShoreLook = { value: new THREE.Vector2(0.6, 0.45) }; // x = opacidad en la orilla · y = tinte claro de agua poco profunda
  u.uShallow = { value: new THREE.Color(0x4f7178) };
  u.uShoreCurve = { value: 0.6 };
  u.uSunGlint = { value: 1 };
  u.uGlintLobes = { value: new THREE.Vector3(0.08, 0.28, 0.9) };
  u.uSilk = { value: 0.6 }; // altura del oleaje: más tranquila que en el visor (1,0), pedido el 16/11/2026
  u.uRipple = { value: new THREE.Vector2(0.04, 3) };
  u.uWater = { value: new THREE.Vector3(0.02, 0, 0.03) };
  u.uShallowWater = { value: new THREE.Color(SHALLOW_COLOR) };
  u.uDepthM = { value: 320 };
  u.uFoam = { value: new THREE.Vector2(0.75, 9.0) };
  mat.transparent = false; mat.depthWrite = true; mat.polygonOffset = false;
  const officialFragment = mat.fragmentShader
    .replace("uniform float alpha;", [
      "uniform float alpha;",
      "uniform sampler2D uShore, uSurf;",
      "uniform vec2 uCrop, uSurfCrop, uShoreLook, uFoam;",
      "uniform vec3 uShallow, uShallowWater;",
      "uniform float uShoreCurve, uSunGlint, uSilk, uDepthM, uScale;",
      "uniform vec2 uRipple;",
      "uniform vec3 uWater;",
      "uniform vec3 uGlintLobes;",
    ].join("\n"))
    .replace("vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;", [
      "vec2 depthUv = worldPosition.xz / uCrop + 0.5;",
      "float depthIn = step(0.0, depthUv.x) * step(depthUv.x, 1.0) * step(0.0, depthUv.y) * step(depthUv.y, 1.0);",
      "float farProx = depthIn * texture2D(uShore, clamp(depthUv, 0.0, 1.0)).a;",
      "float depthT = 1.0 - exp(-(1.0 - farProx) * 1500.0 / uDepthM);",
      "vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * mix(uShallowWater, waterColor, depthT);",
    ].join("\n"))
    .replace("gl_FragColor = vec4( outgoingLight, alpha );", [
      "vec2 shoreUv = worldPosition.xz / uCrop + 0.5;",
      "float inCrop = step(0.0, shoreUv.x) * step(shoreUv.x, 1.0) * step(0.0, shoreUv.y) * step(shoreUv.y, 1.0);",
      "float prox = inCrop * texture2D(uShore, clamp(shoreUv, 0.0, 1.0)).g;",
      "float shallowK = pow(smoothstep(0.0, 1.0, prox), uShoreCurve);",
      "float sunAlign = max(dot(eyeDirection, reflect(-sunDirection, surfaceNormal)), 0.0);",
      "vec3 glint = sunColor * (pow(sunAlign, 6.0) * uGlintLobes.x + pow(sunAlign, 48.0) * uGlintLobes.y + pow(sunAlign, 900.0) * uGlintLobes.z / (1.0+900.0*fwidth(sunAlign))) * uSunGlint;",
      "vec3 waterOut = mix(outgoingLight + glint, uShallow, shallowK * uShoreLook.y);",
      // espuma: distancia al mar desde la costa (m del visor, textura propia de la isla, canal R)
      "vec2 foamUv = worldPosition.xz / uSurfCrop + 0.5;",
      "float foamIn = step(0.0, foamUv.x) * step(foamUv.x, 1.0) * step(0.0, foamUv.y) * step(foamUv.y, 1.0);",
      "float sdfW = (texture2D(uSurf, clamp(foamUv, 0.0, 1.0)).r * 255.0 - 128.0) / 8.0;",
      "float seaD = max(-sdfW, 0.0);",
      "vec2 wpS = worldPosition.xz * uScale;", // ruido de la espuma a la escala del visor
      "float foamBand = foamIn * (1.0 - smoothstep(0.3 * uFoam.y, uFoam.y, seaD));",
      "float edgeF = 1.0 - seaD / uFoam.y;",
      "float foamN = silkValue(wpS * 0.11 + vec2(time * 0.21, -time * 0.17)) * 0.6 + silkValue(wpS * 0.37 - time * 0.3) * 0.4;",
      "float foam = foamBand * smoothstep(0.35, 0.65, edgeF * edgeF * 0.8 + foamN * 0.45 + 0.1 * sin(seaD * 0.9 - time * 1.4) - 0.2);",
      "vec3 foamCol = vec3(0.86, 0.92, 0.95) * (0.35 + 0.65 * clamp(dot(sunColor, vec3(0.333)), 0.0, 1.0));",
      "waterOut = mix(waterOut, foamCol, foam * uFoam.x);",
      "gl_FragColor = vec4( waterOut, 1.0 );",
    ].join("\n"))
    .replace("vec3( 1.5, 1.0, 1.5 )", "vec3( uSilk, 1.0, uSilk )")
    // deformación del reflejo: la distancia en m del visor (en la isla, 15 m ≈ 450 m del visor)
    .replace("vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;",
      "vec2 distortion = surfaceNormal.xz * vec2( 1.0, uRipple.y ) * ( uRipple.x + 1.0 / ( distance * uScale ) ) * distortionScale;")
    .replace("100.0, 2.0, 0.5", "220.0, 2.0, 0.5")
    .replace("float rf0 = 0.3;", "float rf0 = uWater.x;")
    .replace("sunColor * diffuseLight * 0.3", "sunColor * diffuseLight * uWater.z")
    .replace("( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight )",
      "( vec3( uWater.y ) + reflectionSample * ( 1.0 - uWater.y ) + reflectionSample * specularLight )");
  // Oleaje sedoso del visor, sin cambios (en m del visor: `size` lleva la isla a esa escala).
  const silkNoise = `
    #define SILK_BIAS 1.4
    #define SILK_STOCH 1
    float silkHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float silkValue(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(silkHash(i),silkHash(i+vec2(1,0)),f.x),mix(silkHash(i+vec2(0,1)),silkHash(i+vec2(1,1)),f.x),f.y);
    }
    vec3 silkTex(vec2 uv, float bias){
      vec2 dx=dFdx(uv)*exp2(bias), dy=dFdy(uv)*exp2(bias);
      #if SILK_STOCH
      float l=silkValue(uv*0.6)*8.0, ia=floor(l), f=fract(l);
      vec2 oa=sin(vec2(3.0,7.0)*ia), ob=sin(vec2(3.0,7.0)*(ia+1.0));
      vec3 a=textureGrad(normalSampler,uv+oa,dx,dy).xyz, b=textureGrad(normalSampler,uv+ob,dx,dy).xyz;
      return mix(a,b,smoothstep(0.2,0.8,f))*2.0-1.0;
      #else
      return textureGrad(normalSampler,uv,dx,dy).xyz*2.0-1.0;
      #endif
    }
    #define SILK_SCALE 2.5
    #define SILK_SPEED 0.34
    uniform vec4 uBergRipples[4];
    vec4 getNoise(vec2 uv) {
      vec2 waterPoint=uv;
      vec2 bend=vec2(sin(dot(uv,vec2(.0061,.0037)/SILK_SCALE)+time*.05),sin(dot(uv,vec2(-.0029,.0071)/SILK_SCALE)-time*.04));
      uv+=21.0*SILK_SCALE*bend;
      mat2 r1=mat2(.9524,.3048,-.3048,.9524), r1b=mat2(.2588,-.9659,.9659,.2588);
      mat2 r2=mat2(.4226,-.9063,.9063,.4226), r2b=mat2(-.7660,.6428,-.6428,-.7660);
      float sp=time*SILK_SPEED;
      vec3 sA=silkTex(r1*uv/(211.0*SILK_SCALE)+vec2(sp/17.0,sp/29.0),SILK_BIAS);
      vec3 sB=silkTex(r1b*uv/(163.0*SILK_SCALE)+vec2(sp/19.0,-sp/31.0),SILK_BIAS);
      vec3 mA=silkTex(r2*uv/(83.0*SILK_SCALE)+vec2(-sp/37.0,sp/41.0),SILK_BIAS);
      float pixelFootprint=length(fwidth(uv));
      float mediumWeight=1.0-smoothstep(8.0,45.0,pixelFootprint);
      vec2 slopes=.45*(sA.xy*r1+sB.xy*r1b);
      #ifdef SILK_FINE
      vec3 mB=silkTex(r2b*uv/(67.0*SILK_SCALE)+vec2(sp/43.0,sp/47.0),SILK_BIAS);
      slopes+=mediumWeight*.2*(mA.xy*r2+mB.xy*r2b);
      mat2 r3=mat2(-.5048,.8632,-.8632,-.5048);
      vec2 fuv=r3*uv/(31.0*SILK_SCALE)+vec2(-sp/59.0,-sp/61.0);
      float fineK=.12*(1.0-smoothstep(.002,.01,length(fwidth(fuv))));
      slopes+=fineK*(silkTex(fuv,1.0).xy*r3);
      #else
      slopes+=mediumWeight*.38*(mA.xy*r2);
      #endif
      for(int i=0;i<4;i++){
        vec4 event=uBergRipples[i];
        if(event.w<0.0) continue;
        vec2 delta=waterPoint-event.xy;
        float reach=event.z+event.w*8.0+18.0;
        if(dot(delta,delta)>reach*reach) continue;
        float radius=length(delta),edge=radius-event.z;
        float front=edge-event.w*8.0;
        float envelope=exp(-front*front/180.0)*smoothstep(-8.0,5.0,edge);
        float fade=(1.0-smoothstep(.2,1.5,event.w))*smoothstep(0.0,.18,event.w);
        float filtered=1.0-smoothstep(3.0,12.0,pixelFootprint);
        slopes+=delta/max(radius,1.0)*cos(front*.48)*envelope*fade*filtered*.16;
      }
      return vec4(slopes,mix(sA.z,mA.z,.38),1.0);
    }
  `;
  const noiseFn = /vec4 getNoise\( vec2 uv \) \{[\s\S]*?\n\t*\}/;
  mat.fragmentShader = officialFragment.replace(noiseFn, (o.mobile ? "" : "#define SILK_FINE\n") + silkNoise);
  mat.customProgramCacheKey = () => "antaris-agua-visor-isla" + (o.mobile ? "-movil" : "");
  mat.needsUpdate = true;

  // Reflejo planar (segundo dibujo de la escena) con la cadencia del visor: en movimiento, uno de cada MIRROR_EVERY
  // cuadros; en los otros el agua reusa el último.
  const mirror = mesh.onBeforeRender;
  let dirty = true, moveFrames = 0, mirrorRenders = 0, speed = 0.7; // oleaje más lento que en el visor (1)
  const world = new THREE.Matrix4(), projection = new THREE.Matrix4();
  mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
    const changed = !world.equals(camera.matrixWorld) || !projection.equals(camera.projectionMatrix);
    if (!dirty && !changed) return;
    if (!dirty && changed && MIRROR_EVERY > 1 && (++moveFrames % MIRROR_EVERY) !== 0) { u.eye.value.setFromMatrixPosition(camera.matrixWorld); return; }
    const swap = o.mirrorSwap;
    if (swap) { for (const h of swap.hide) h.visible = false; for (const v of swap.show) v.visible = true; }
    try { mirror.call(mesh, renderer, scene, camera, geometry, material, group); }
    finally { if (swap) { for (const h of swap.hide) h.visible = true; for (const v of swap.show) v.visible = false; } }
    mirrorRenders++;
    world.copy(camera.matrixWorld); projection.copy(camera.projectionMatrix); dirty = false;
  };
  return {
    mesh,
    /** Luz del sol (como en el visor: color × luz directa, agua más oscura de noche). */
    setSun(direction: THREE.Vector3, color: THREE.Color, direct = 1, daylight = 1) {
      u.sunDirection.value.copy(direction).normalize();
      u.sunColor.value.copy(color).multiplyScalar(direct);
      u.waterColor.value.setHex(WATER_COLOR).multiplyScalar(0.1 + 0.9 * daylight);
      u.uShallowWater.value.setHex(SHALLOW_COLOR).multiplyScalar(0.1 + 0.9 * daylight);
      dirty = true;
    },
    /** Pide redibujar el reflejo en el próximo cuadro. */
    refresh() { dirty = true; },
    time(t: number) { u.time.value = t * speed; },
    stats: () => ({ pasesPlanares: mirrorRenders, resolucion: [reflectionWidth, reflectionHeight], cadencia: MIRROR_EVERY }),
    dispose() { (u.normalSampler.value as THREE.Texture).dispose(); mesh.geometry.dispose(); mat.dispose(); },
  };
}

/**
 * Texturas de costa para el agua, desde la distancia con signo a la costa de la isla (m, + tierra; grilla n × n que
 * cubre ±half). Fuera de la grilla todo es mar: la distancia sigue creciendo desde el borde.
 */
export function oceanShore(sdf: Float32Array, n: number, half: number, scale: number, margin = 40): OceanShore {
  const at = coastDistanceSampler(sdf, n, half);
  const S = 256, shoreCrop = 2 * (half + margin), shore = new Uint8Array(S * S * 4);
  const nearM = SHORE_M / scale, farM = FAR_SHORE_M / scale;
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) {
    const sea = Math.max(-at(((c + 0.5) / S - 0.5) * shoreCrop, ((r + 0.5) / S - 0.5) * shoreCrop), 0), o = (r * S + c) * 4;
    shore[o + 1] = Math.round(Math.max(0, 1 - sea / nearM) * 255);
    shore[o + 3] = Math.round(Math.max(0, 1 - sea / farM) * 255);
  }
  const F = 1024, foam = new Uint8Array(F * F), foamCrop = 2 * half;
  for (let r = 0; r < F; r++) for (let c = 0; c < F; c++)
    foam[r * F + c] = Math.round(Math.min(255, Math.max(0, at(((c + 0.5) / F - 0.5) * foamCrop, ((r + 0.5) / F - 0.5) * foamCrop) * scale * 8 + 128)));
  const tex = (data: Uint8Array, size: number, format: THREE.PixelFormat) => {
    const t = new THREE.DataTexture(data, size, size, format);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return t;
  };
  return { shore: tex(shore, S, THREE.RGBAFormat), shoreCrop, foam: tex(foam, F, THREE.RedFormat), foamCrop };
}

/** Distancia con signo a la costa (m, + tierra) en cualquier punto: bilineal en la grilla; fuera, sigue bajando desde el borde. */
export function coastDistanceSampler(sdf: Float32Array, n: number, half: number) {
  const cell = (2 * half) / (n - 1);
  return (x: number, z: number) => {
    const cx = Math.min(Math.max(x, -half), half), cz = Math.min(Math.max(z, -half), half), out = Math.hypot(x - cx, z - cz);
    const gx = Math.min((cx + half) / cell, n - 1.001), gz = Math.min((cz + half) / cell, n - 1.001), i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, o = j * n + i;
    const d = (sdf[o] * (1 - fx) + sdf[o + 1] * fx) * (1 - fz) + (sdf[o + n] * (1 - fx) + sdf[o + n + 1] * fx) * fz;
    return d - out;
  };
}
