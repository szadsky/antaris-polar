import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
// waternormals.jpg de three (1024², 249 KB) reducida a 512² WebP: el agua del hero se ve casi siempre rasante (mips bajos).
import normalUrl from './agua-normales.webp';

/**
 * Agua del canal Beagle (reconstrucción artística, no oleaje medido). Base: el Water de three con reflejo planar,
 * como el agua del visor (terreno-estilizado/src/ocean.ts), con su oleaje "sedoso" estocástico (sin repetición
 * visible). Cambios para el hero:
 *  - color de fondo por fila: la mediana por fila del agua pintada (capa 04, sin reflejos ni barcos), anclada al
 *    mundo (cada punto del agua toma el color de la fila donde la cámara del hero lo ve), así el canal conserva el
 *    degradado de la referencia aunque la cámara se mueva;
 *  - los reflejos son reales: el reflejo planar dibuja los barcos y las boyas. El cielo y las montañas pintados se
 *    ocultan en ese pase (un espejo perfecto pondría las cumbres junto a la orilla y la referencia no las pinta), y la
 *    loma, el pasto y el pingüino también (su reflejo queda casi todo detrás de la loma y oscurecía la orilla).
 *    El pase se dibuja sobre fondo transparente y su alfa mezcla el reflejo sobre el color de la fila;
 *  - deformación del reflejo alargada en vertical (estelas largas de agua calma, como en la referencia).
 */
function rippleMap() {
  const tex = new THREE.TextureLoader().load(normalUrl);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4;
  return tex;
}

// Oleaje sedoso del visor (ocean.ts, sin cambios salvo el modo móvil): mosaico aperiódico con muestreo estocástico.
const SILK_NOISE = /* glsl */ `
  #define SILK_BIAS 1.4
  float silkHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float silkValue(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(silkHash(i),silkHash(i+vec2(1,0)),f.x),mix(silkHash(i+vec2(0,1)),silkHash(i+vec2(1,1)),f.x),f.y);
  }
  vec3 silkTex(vec2 uv, float bias){
    vec2 dx=dFdx(uv)*exp2(bias), dy=dFdy(uv)*exp2(bias);
    float l=silkValue(uv*0.6)*8.0, ia=floor(l), f=fract(l);
    vec2 oa=sin(vec2(3.0,7.0)*ia), ob=sin(vec2(3.0,7.0)*(ia+1.0));
    vec3 a=textureGrad(normalSampler,uv+oa,dx,dy).xyz, b=textureGrad(normalSampler,uv+ob,dx,dy).xyz;
    return mix(a,b,smoothstep(0.2,0.8,f))*2.0-1.0;
  }
  #define SILK_SCALE 2.5
  #define SILK_SPEED 0.34
  vec4 getNoise(vec2 uv) {
    vec2 bend=vec2(sin(dot(uv,vec2(.0061,.0037)/SILK_SCALE)+time*.05),sin(dot(uv,vec2(-.0029,.0071)/SILK_SCALE)-time*.04));
    uv+=21.0*SILK_SCALE*bend;
    mat2 r1=mat2(.9524,.3048,-.3048,.9524), r1b=mat2(.2588,-.9659,.9659,.2588);
    mat2 r2=mat2(.4226,-.9063,.9063,.4226);
    float sp=time*SILK_SPEED;
    vec3 sA=silkTex(r1*uv/(211.0*SILK_SCALE)+vec2(sp/17.0,sp/29.0),SILK_BIAS);
    vec3 sB=silkTex(r1b*uv/(163.0*SILK_SCALE)+vec2(sp/19.0,-sp/31.0),SILK_BIAS);
    vec3 mA=silkTex(r2*uv/(83.0*SILK_SCALE)+vec2(-sp/37.0,sp/41.0),SILK_BIAS);
    float pixelFootprint=length(fwidth(uv));
    float mediumWeight=1.0-smoothstep(8.0,45.0,pixelFootprint);
    vec2 slopes=.45*(sA.xy*r1+sB.xy*r1b) + mediumWeight*.38*(mA.xy*r2);
    return vec4(slopes,mix(sA.z,mA.z,.38),1.0);
  }
`;

/**
 * Agua de 40 km de ancho hasta 4,99 km, justo antes de las laderas (5 km): sin pelea de profundidad en el horizonte, con filas espaciadas en forma
 * exponencial (de 2 m a 5,2 km) y 48 columnas. Con un solo cuadro gigante, la interpolación de la coordenada del
 * reflejo perdía precisión cerca de la cámara y el reflejo se veía en bloques.
 */
function waterGeometry() {
  const ROWS = 72, COLS = 48, NEAR = 2, FAR = 4990, HALF = 20000, pos: number[] = [], idx: number[] = [];
  for (let r = 0; r <= ROWS; r++) {
    const d = r === 0 ? -10 : NEAR * Math.pow(FAR / NEAR, (r - 1) / (ROWS - 1)); // distancia hacia −z (m)
    for (let c = 0; c <= COLS; c++) {
      const t = c / COLS * 2 - 1, x = Math.sign(t) * Math.pow(Math.abs(t), 2.2) * HALF; // columnas densas al centro
      pos.push(x, d, 0); // plano local xy: con rotation.x = −π/2, y local = −z del mundo
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const a = r * (COLS + 1) + c, b = a + 1, cc = a + COLS + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export interface WaterRows { primera: number; filas: [number, number, number][] }

export function createWater(o: { rows: WaterRows; refViewProj: THREE.Matrix4; imageH: number; mobile: boolean; sun: THREE.Vector3;
  /** Objetos que no se reflejan (cielo y montañas pintados: la referencia no pinta su reflejo). */
  mirrorHide?: THREE.Object3D[] }) {
  const aspect = 1672 / 941, longest = o.mobile ? 640 : 1024;
  const geo = waterGeometry();
  const mesh = new Water(geo, {
    textureWidth: longest, textureHeight: Math.round(longest / aspect), waterNormals: rippleMap(), waterColor: 0x23384c,
    sunColor: 0xfff1dc, sunDirection: o.sun.clone().normalize(), distortionScale: 0.25, clipBias: 0.0005, fog: false,
  });
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, 0);
  mesh.name = 'canal-beagle';
  const mat = mesh.material as THREE.ShaderMaterial, u = mat.uniforms;
  const reflection = u.mirrorSampler.value as THREE.Texture;
  reflection.generateMipmaps = true; reflection.minFilter = THREE.LinearMipmapLinearFilter;

  // Degradado por fila (sRGB → la GPU lo pasa a lineal al leerlo).
  const n = o.rows.filas.length, data = new Uint8Array(n * 4);
  o.rows.filas.forEach((c, i) => data.set([c[0], c[1], c[2], 255], i * 4));
  const rowsTex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  rowsTex.colorSpace = THREE.SRGBColorSpace; rowsTex.magFilter = rowsTex.minFilter = THREE.LinearFilter; rowsTex.needsUpdate = true;

  u.size.value = 60; // ondas de ~10 m cerca de la loma, finas hacia el horizonte
  u.uRows = { value: rowsTex };
  u.uRowRange = { value: new THREE.Vector3(o.rows.primera, n, o.imageH) };
  u.uRefViewProj = { value: o.refViewProj };
  // x = opacidad del reflejo · y = sin uso · z = brillo del reflejo
  u.uRefl = { value: new THREE.Vector3(0.9, 0, 1.6) };
  u.uTexture = { value: new THREE.Vector2(0.32, 0.035) }; // x = ondulación · y = fracción de celdas con hielo
  u.uStreak = { value: 0.006 }; // paso vertical de las muestras de la estela (uv del reflejo)
  u.uStretch = { value: new THREE.Vector2(0.25, 1.0) }; // deformación del reflejo (x horizontal, y vertical)
  u.uGlint = { value: 0.35 };
  mat.toneMapped = false; // el color de la fila ya está en el espacio de la referencia

  mat.fragmentShader = mat.fragmentShader
    .replace('uniform float alpha;', 'uniform float alpha;\nuniform sampler2D uRows;\nuniform vec3 uRowRange, uRefl;\nuniform vec2 uStretch;\nuniform float uStreak;\nuniform vec2 uTexture;\nuniform float uGlint;\nuniform mat4 uRefViewProj;')
    .replace(/vec4 getNoise\( vec2 uv \) \{[\s\S]*?\n\t*\}/, SILK_NOISE)
    .replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );', 'vec3 surfaceNormal = normalize( noise.xzy * vec3( 0.55, 1.0, 0.55 ) );')
    .replace('vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;',
      'vec2 distortion = surfaceNormal.xz * uStretch * ( 0.002 + 1.0 / distance ) * distortionScale;')
    .replace(/vec3 albedo = mix\([\s\S]*?gl_FragColor = vec4\( outgoingLight, alpha \);/, /* glsl */ `
      // Fila de la referencia donde la cámara del hero ve este punto del agua.
      vec4 refClip = uRefViewProj * vec4(worldPosition.xyz, 1.0);
      float row = (1.0 - (refClip.y / refClip.w * 0.5 + 0.5)) * uRowRange.z;
      vec3 rowColor = texture2D(uRows, vec2(clamp((row - uRowRange.x + 0.5) / uRowRange.y, 0.0, 1.0), 0.5)).rgb;
      // Reflejo con fondo transparente (alfa = cobertura de barcos, loma y pingüino), estirado en vertical:
      // 9 muestras a lo largo de la estela, como el agua calma de la referencia.
      // Ondulación de agua calma: líneas finas alargadas en horizontal (x), que se desvanecen donde su período baja
      // de ~2 px (sin parpadeo a lo lejos). Aclara/oscurece el agua y corta las estelas del reflejo.
      vec2 ripP = vec2(worldPosition.x * 0.06, worldPosition.z * 0.85) + vec2(time * 0.03, time * 0.22);
      float ripple = (silkValue(ripP) - 0.5) + 0.5 * (silkValue(ripP * vec2(1.7, 2.3) + 7.1) - 0.5);
      float ripAA = 1.0 - smoothstep(0.25, 0.6, fwidth(ripP.y));
      ripple *= ripAA;
      vec2 ruv = mirrorCoord.xy / mirrorCoord.w + distortion + vec2(ripple * 0.006, 0.0);
      vec4 refl = vec4(0.0); float wsum = 0.0;
      for (int i = -4; i <= 4; i++) {
        float w = 1.0 - abs(float(i)) / 5.0;
        refl += texture2D(mirrorSampler, ruv + vec2(0.0, float(i) * uStreak), 1.0) * w; wsum += w;
      }
      refl /= wsum;
      float cover = refl.a * uRefl.x * (0.75 + 0.25 * reflectance);
      vec3 col = rowColor * (1.0 - cover) + refl.rgb * uRefl.x * uRefl.z * (0.75 + 0.25 * reflectance);
      // Textura del agua calma de la referencia: ondulación horizontal fina (más clara/oscura según la pendiente de
      // la ola hacia la cámara) y trocitos de hielo flotando, alargados en horizontal, solo cerca (< 400 m).
      col *= 1.0 + uTexture.x * ripple;
      col += refl.rgb * max(ripple, 0.0) * 0.6 * uRefl.x; // las estelas brillan en las crestas
      vec2 icePos = worldPosition.xz * vec2(0.22, 1.1);
      vec2 iceCell = floor(icePos);
      float iceH = fract(sin(dot(iceCell, vec2(127.1, 311.7))) * 43758.5453);
      vec2 iceF = fract(icePos) - 0.5 - 0.3 * (vec2(fract(iceH * 13.7), fract(iceH * 71.3)) - 0.5);
      float ice = step(1.0 - uTexture.y, iceH) * smoothstep(0.22, 0.05, length(iceF * vec2(1.0, 2.6)));
      ice *= 1.0 - smoothstep(60.0, 400.0, distance);
      col = mix(col, vec3(0.78, 0.84, 0.9), ice * 0.75);
      float sunAlign = max(dot(eyeDirection, reflect(-sunDirection, surfaceNormal)), 0.0);
      col += sunColor * (pow(sunAlign, 48.0) * 0.15 + pow(sunAlign, 600.0) * 0.6) * uGlint;
      gl_FragColor = vec4(max(col, 0.0), 1.0);`);
  mat.customProgramCacheKey = () => 'antaris-hero-canal-beagle';
  mat.needsUpdate = true;

  let renders = 0;
  const clearColor = new THREE.Color();
  const mirror = mesh.onBeforeRender;
  mesh.onBeforeRender = (...args) => {
    renders++;
    const [renderer, scene] = args;
    const hide = o.mirrorHide ?? [], was = hide.map((h) => h.visible), background = scene.background, alpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    // fondo transparente: el alfa del reflejo queda como cobertura de lo reflejado
    hide.forEach((h) => { h.visible = false; }); scene.background = null; renderer.setClearColor(0x000000, 0);
    try { mirror.apply(mesh, args); }
    finally { hide.forEach((h, i) => { h.visible = was[i]; }); scene.background = background; renderer.setClearColor(clearColor, alpha); }
  };
  return {
    mesh,
    time(t: number) { u.time.value = t * 0.6; },
    stats: () => ({ pasesReflejo: renders, resolucion: [longest, Math.round(longest / aspect)] }),
    dispose() { geo.dispose(); mat.dispose(); rowsTex.dispose(); (u.normalSampler.value as THREE.Texture).dispose(); },
  };
}
