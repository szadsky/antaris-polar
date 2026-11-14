import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import type { Terrain } from "./terrain";
import type { Tier } from "./quality";

import normalUrl from "./waternormals.jpg";

function rippleMap(maxAniso:number) {
  const tex=new THREE.TextureLoader().load(normalUrl);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.colorSpace=THREE.NoColorSpace;
  tex.minFilter=THREE.LinearMipmapLinearFilter;tex.magFilter=THREE.LinearFilter;tex.generateMipmaps=true;tex.anisotropy=Math.min(4,maxAniso);
  return tex;
}
// Color del agua profunda vista desde arriba (lo que se ve a través de la superficie con poco reflejo).
const WATER_COLOR=0x103a42;
// Color propio del agua poco profunda junto a la costa (turquesa claro): color según la profundidad.
const SHALLOW_COLOR=0x2f8f95;
// Reflejo planar con la cámara en movimiento: uno de cada N cuadros (1 = todos).
const MIRROR_EVERY=2; // en Brown (alta, 1282 × 787): cuadros de 16 y 10 ms alternados en vez de 16 ms todos (p95 18)
export function createOcean(size:number,sun:THREE.Vector3,mobile:boolean,initial:Tier, expanded=false,maxAniso=1,diorama=false) {
  const aspect=window.innerWidth/Math.max(1,window.innerHeight);
  // Lado mayor del reflejo planar (px). `?reflejoRes=` lo cambia para medir.
  const longest=Number(new URLSearchParams(location.search).get("reflejoRes"))||(mobile?384:512); // 768 → 512: la resolución casi no cambia el costo (es la geometría) y ahorra memoria
  let reflectionWidth=Math.max(128,Math.round(longest*Math.min(1,aspect)));
  let reflectionHeight=Math.max(128,Math.round(longest*Math.min(1,1/aspect)));
  const mesh=new Water(new THREE.PlaneGeometry(size*8,size*8),{
    textureWidth:reflectionWidth,textureHeight:reflectionHeight,waterNormals:rippleMap(maxAniso),waterColor:WATER_COLOR,
    sunColor:0xd9eafa,sunDirection:sun,distortionScale:1.4,clipBias:0.0001,fog:true,
  });
  mesh.rotation.x=-Math.PI/2;
  mesh.name="océano";
  // Piso a 30 m bajo el agua (donde termina el fondo del terreno): lo que se ve a través del agua
  // semitransparente siempre es fondo oscuro, nunca el cielo. 2 triángulos; local +z = arriba.
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(size*8,size*8),new THREE.MeshBasicMaterial({color:0x0a2229}));
  floor.position.z=-30; // = SEABED_MAX_M del workerfloor.name="fondo-marino";
  mesh.add(floor);
  const mat=mesh.material,u=mat.uniforms;
  const ripples=Array.from({length:4},()=>new THREE.Vector4(0,0,0,-1));
  u.uBergRipples={value:ripples};
  let nextRipple=0;
  const reflection=u.mirrorSampler.value as THREE.Texture;reflection.generateMipmaps=true;reflection.minFilter=THREE.LinearMipmapLinearFilter;reflection.magFilter=THREE.LinearFilter;
  // Agua algo transparente junto a la orilla (0,6: con 0,18–0,42 se veía oscura) y con un tinte claro de
  // agua poco profunda; opaca a partir de ~160 m de la costa.
  // La cercanía a la costa sale del canal G de la textura de luz del terreno (sin pases nuevos).
  u.uShore={value:new THREE.DataTexture(new Uint8Array(4),1,1)};
  u.uCrop={value:new THREE.Vector2(1,1)};
  u.uShoreLook={value:new THREE.Vector2(0.6,0.45)}; // x = opacidad en la orilla · y = tinte claro de agua poco profunda
  u.uShallow={value:new THREE.Color(0x4f7178)};
  u.uShoreCurve={value:0.6}; // <1: la transparencia llega más lejos y se desvanece más suave
  u.uSunGlint={value:1}; // intensidad del reflejo del sol (GLSL)
  u.uGlintLobes={value:new THREE.Vector3(0.08,0.28,0.9)}; // pesos: amplio, camino de luz, disco
  u.uSilk={value:1.0}; // altura del oleaje (Water original 1,5): con 0,5 parecía un espejo
  u.uRipple={value:new THREE.Vector2(0.04,3)}; // x = deformación del reflejo a lo lejos (Water: 0,001) · y = estiramiento vertical
  u.uWater={value:new THREE.Vector3(0.02,0,0.03)}; // x = reflejo base (Fresnel) · y = gris fijo del reflejo · z = difusa del sol (Water: 0,3 · 0,1 · 0,3)
  u.uShore.value.needsUpdate=true;
  mat.transparent=false;mat.depthWrite=true;
  // Use geometric depth: slope-dependent offsets make water cross shallow terrain.
  mat.polygonOffset=false;
  // Color según la profundidad (reconstrucción artística, no batimetría medida): el color propio del agua pasa de
  // turquesa claro junto a la costa a azul profundo mar adentro, con la distancia a la costa de largo alcance (canal
  // A de la textura de luz del terreno, 0–1,5 km). Mismo criterio que el fondo curvo del corte del diorama.
  u.uShallowWater={value:new THREE.Color(SHALLOW_COLOR)};
  u.uDepthM={value:320}; // distancia (m) a la que el color llega a ~63 % del profundo
  // Espuma en la orilla: franja de ~9 m del lado del mar (distancia con signo a la costa de la textura de superficie
  // del terreno, la misma línea de agua de la malla), cortada por un ruido que avanza hacia la costa.
  u.uSurf={value:new THREE.DataTexture(new Uint8Array(4),1,1)};
  u.uFoam={value:new THREE.Vector2(0.75,9.0)}; // x = intensidad · y = ancho (m; con 5 quedaba debajo del borde del terreno)
  // Relieve de la malla (alturas REMA en la grilla de la malla, R16F): paralaje del reflejo precalculado.
  u.uRelief={value:new THREE.DataTexture(new Float32Array(1),1,1,THREE.RedFormat,THREE.FloatType)};
  u.uReliefSize={value:new THREE.Vector2(1,1)};
  u.uReliefK={value:1};
  const officialFragment=mat.fragmentShader
    .replace("uniform float alpha;",[
      "uniform float alpha;",
      "uniform sampler2D uShore, uSurf, uRelief;",
      "uniform vec2 uCrop, uShoreLook, uFoam, uReliefSize;",
      "uniform vec3 uShallow, uShallowWater;",
      "uniform float uShoreCurve, uSunGlint, uSilk, uDepthM, uReliefK;",
      "uniform vec2 uRipple;",
      "uniform vec3 uWater;",
      "uniform vec3 uGlintLobes;",
      // uv del recorte (0..1, mundo xz / ancho + 0.5) → centro del texel de la grilla de la malla
      "vec2 meshUv(vec2 uv) { return (uv * (uReliefSize - 1.0) + 0.5) / uReliefSize; }",
      "float reliefAt(vec2 uv) { return texture2D(uRelief, meshUv(uv)).r * uReliefK; }", // altura en mundo
    ].join("\n"))
    .replace("vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;",[
      "vec2 depthUv = worldPosition.xz / uCrop + 0.5;",
      "float depthIn = step(0.0, depthUv.x) * step(depthUv.x, 1.0) * step(0.0, depthUv.y) * step(depthUv.y, 1.0);",
      "float farProx = depthIn * texture2D(uShore, clamp(depthUv, 0.0, 1.0)).a;", // fuera del recorte: profundo
      "float depthT = 1.0 - exp(-(1.0 - farProx) * 1500.0 / uDepthM);",
      "vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * mix(uShallowWater, waterColor, depthT);",
    ].join("\n"))
    .replace("gl_FragColor = vec4( outgoingLight, alpha );",[
      "vec2 shoreUv = worldPosition.xz / uCrop + 0.5;",
      "float inCrop = step(0.0, shoreUv.x) * step(shoreUv.x, 1.0) * step(0.0, shoreUv.y) * step(shoreUv.y, 1.0);",
      "float prox = inCrop * texture2D(uShore, clamp(shoreUv, 0.0, 1.0)).g;",
      // tinte claro de agua poco profunda en la superficie (uShoreLook.y = intensidad en la orilla)
      "float shallowK = pow(smoothstep(0.0, 1.0, prox), uShoreCurve);", // transición gradual hacia mar adentro
      // Reflejo del sol (GLSL): lóbulo estrecho (disco del sol reflejado) + lóbulo ancho (camino de luz
      // sobre las ondas), con la normal de las ondas del propio Water; se suma a la luz de salida.
      "float sunAlign = max(dot(eyeDirection, reflect(-sunDirection, surfaceNormal)), 0.0);",
      // tres lóbulos: x = amplio (aclara el agua del lado del sol, visible desde casi cualquier vista),
      // y = camino de luz sobre las ondas, z = disco del sol reflejado
      "vec3 glint = sunColor * (pow(sunAlign, 6.0) * uGlintLobes.x + pow(sunAlign, 48.0) * uGlintLobes.y + pow(sunAlign, 900.0) * uGlintLobes.z / (1.0+900.0*fwidth(sunAlign))) * uSunGlint;",
      "vec3 waterOut = mix(outgoingLight + glint, uShallow, shallowK * uShoreLook.y);",
      // espuma: distancia al mar desde la costa (m), olitas que avanzan hacia la orilla y ruido que las corta
      "float sdfW = (texture2D(uSurf, clamp(shoreUv, 0.0, 1.0)).a * 255.0 - 128.0) / 8.0;",
      "float seaD = max(-sdfW, 0.0);",
      // Sin corte del lado tierra: el polígono del agua (ADD vectorial) llega en partes unos metros más adentro que
      // la costa de la textura (raster); con `step(sdfW, 0.5)` ahí quedaba agua sin espuma entre la espuma y la nieve.
      "float foamBand = inCrop * (1.0 - smoothstep(0.3 * uFoam.y, uFoam.y, seaD));",
      // Pegada a la orilla y rota en manchas hacia afuera. Antes las olitas (seno cada ~5 m, peso 0,35) pesaban
      // más que la cercanía a la costa: quedaba un aro brillante separado de la orilla por un valle, y desde
      // arriba se leía como una segunda costa. Ahora la cercanía manda y el seno solo modula un poco.
      "float edgeF = 1.0 - seaD / uFoam.y;",
      "float foamN = silkValue(worldPosition.xz * 0.11 + vec2(time * 0.21, -time * 0.17)) * 0.6 + silkValue(worldPosition.xz * 0.37 - time * 0.3) * 0.4;",
      "float foam = foamBand * smoothstep(0.35, 0.65, edgeF * edgeF * 0.8 + foamN * 0.45 + 0.1 * sin(seaD * 0.9 - time * 1.4) - 0.2);",
      "vec3 foamCol = vec3(0.86, 0.92, 0.95) * (0.35 + 0.65 * clamp(dot(sunColor, vec3(0.333)), 0.0, 1.0));",
      "waterOut = mix(waterOut, foamCol, foam * uFoam.x);",
      "gl_FragColor = vec4( waterOut, 1.0 );",
    ].join("\n"))
    .replace("#include <fog_fragment>", expanded ? "#include <fog_fragment>\n#ifdef USE_FOG\ngl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,smoothstep(5050.,5990.,max(abs(worldPosition.x),abs(worldPosition.z))));\n#endif" : "#include <fog_fragment>")
    .replace("vec3( 1.5, 1.0, 1.5 )","vec3( uSilk, 1.0, uSilk )")
    // Reflejo de agua, no de espejo: el Water deforma el reflejo con 0,001 + 1/distancia, casi nada a
    // 1–2 km, y las montañas lejanas se reflejaban nítidas. uRipple.x = deformación mínima a lo lejos,
    // uRipple.y = estiramiento vertical (en el agua real los reflejos se alargan hacia el observador).
    .replace("vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;",
      "vec2 distortion = surfaceNormal.xz * vec2( 1.0, uRipple.y ) * ( uRipple.x + 1.0 / distance ) * distortionScale;")
    // brillo del sol nítido (220): con 65 se veía ancho y blando, como un líquido viscoso
    .replace("100.0, 2.0, 0.5","220.0, 2.0, 0.5")
    // Fresnel de agua: el Water usa un reflejo base de 0,3 más un gris fijo de 0,1, y eso la hace ver
    // como metal o espejo desde cualquier ángulo. El agua real refleja ~2 % mirando hacia abajo (se ve su
    // color profundo) y casi todo al ras del horizonte. uWater.x = reflejo base, uWater.y = gris fijo.
    .replace("float rf0 = 0.3;","float rf0 = uWater.x;")
    // el agua casi no tiene luz difusa: con 0,3 la luz cálida del sol la volvía marrón al bajar el Fresnel
    .replace("sunColor * diffuseLight * 0.3","sunColor * diffuseLight * uWater.z")
    .replace("( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight )",
      "( vec3( uWater.y ) + reflectionSample * ( 1.0 - uWater.y ) + reflectionSample * specularLight )");
  // Oleaje sedoso y sin repetición visible. El Water original suma cuatro lecturas del mapa de normales:
  // dos casi a la misma escala (103 y 107 m), alineadas a los ejes, que dibujaban un patrón cada ~105 m.
  // Acá: el dominio se curva con dos senos lentos (las crestas nunca vuelven a alinearse), las capas van a
  // escalas no conmensurables (211 / 83 / 31 m) y giradas entre sí. Altura del oleaje: uSilk.
  // Sin mosaico: cada capa se lee con muestreo estocástico (técnica de Íñigo Quílez, "texture
  // repetition"): un ruido suave elige un desplazamiento al azar por zona y se funden dos lecturas, así la
  // misma porción de textura no vuelve a aparecer en cuadrícula. textureGrad con las derivadas de la uv
  // continua evita costuras de mipmap; multiplicarlas por 2^SILK_BIAS equivale al bias (agua lisa).
  const silkNoise=`
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
    // Textura de olas (versión azul verdosa) con capas cruzadas. En cada escala se suman dos lecturas de
    // tamaño y giro distintos (211 y 163 m; 83 y 67 m) que avanzan en direcciones opuestas: su cruce cambia
    // de forma con el tiempo (no se ve una imagen que se desliza) y nunca repite el mismo dibujo. Cada
    // lectura además es estocástica (silkTex). En escritorio, capa fina de 31 m que se apaga a lo lejos.
    // Se probaron olas calculadas (suma de senos): desde arriba se cruzaban en una trama de rombos.
    // SILK_SCALE agranda todas las capas (con 1 las ondas eran chicas y el agua se veía revuelta).
    // Independent UV phase velocities follow the Water.js animation pattern.
    // Spatial scale controls wave size only; it must not slow the animation.
    #define SILK_SCALE 2.5
    #define SILK_SPEED 0.34
    uniform vec4 uBergRipples[4];
    vec4 getNoise(vec2 uv) {
      vec2 waterPoint=uv;
      vec2 bend=vec2(sin(dot(uv,vec2(.0061,.0037)/SILK_SCALE)+time*.05),sin(dot(uv,vec2(-.0029,.0071)/SILK_SCALE)-time*.04));
      uv+=21.0*SILK_SCALE*bend;
      mat2 r1=mat2(.9524,.3048,-.3048,.9524), r1b=mat2(.2588,-.9659,.9659,.2588);
      mat2 r2=mat2(.4226,-.9063,.9063,.4226), r2b=mat2(-.7660,.6428,-.6428,-.7660);
      // Like Water.js, time offsets are UV phase, independent of world texture scale.
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
      // Four bounded interaction impulses, no textures or extra render passes.
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
  const noiseFn=/vec4 getNoise\( vec2 uv \) \{[\s\S]*?\n\t*\}/;
  const desktopFragment=officialFragment.replace(noiseFn,"#define SILK_FINE\n"+silkNoise);
  const mobileFragment=officialFragment.replace(noiseFn,silkNoise); // sin capa fina ni segunda capa media
  const skyFragment=mobileFragment.replace(/vec3 reflectionSample = [^;]+;/,
    "vec3 reflectionSample=mix(vec3(.24,.36,.44),vec3(.085,.16,.22),clamp(reflect(-eyeDirection,surfaceNormal).y,0.,1.));");  // A reflection only needs the silhouette and broad snow/rock tones.
  // Reflejo precalculado (calidad baja y media, cuando la base tiene cubemap): el paisaje capturado una vez desde
  // un punto sobre el agua (reflection-bake.ts), leído en espacio mundo con la misma deformación del oleaje y
  // Fresnel del Water. Sin segundo dibujo de la escena.
  // Paralaje: leer el cubemap solo con la dirección de reflexión supone que todo está infinitamente lejos, y la
  // costa reflejada aparecía corrida respecto de la orilla real (más cuanto más lejos del punto de captura). Se
  // sigue el rayo reflejado sobre las alturas de la malla (uRelief) hasta el primer punto de terreno y se lee el
  // cubemap en la dirección desde el punto de captura hacia ese punto. Sin impacto (cielo o fuera del recorte):
  // dirección directa. Si ese punto no se veía desde la captura (cara de espaldas o relieve en el medio), un tono
  // de terreno estimado (uEnvSnow / uEnvRock según la pendiente, con el sol) en vez de lo que lo tapaba.
  u.uEnvSnow={value:new THREE.Vector3(0.74,0.78,0.82)}; // lineal
  u.uEnvRock={value:new THREE.Vector3(0.2,0.21,0.23)};
  u.uEnv={value:null as THREE.CubeTexture|null};
  u.uEnvShore={value:0.0}; // atenuación hacia el cielo en la orilla (antes 0.5, para disimular el desfase sin paralaje)
  u.uEnvRipple={value:0.08}; // cuánto desvía el oleaje la dirección de reflexión (1 = normal plena: gris moteado)
  u.uEnvCenter={value:new THREE.Vector3()};
  u.uReliefTop={value:0};
  u.uReliefFar={value:1};
  // Horizonte visto desde el punto de captura (tangente de la elevación máxima del relieve por acimut y distancia):
  // decide en una lectura si el punto de impacto se veía desde la captura. Ver buildHorizon.
  u.uHorizon={value:new THREE.DataTexture(new Float32Array([-100]),1,1,THREE.RedFormat,THREE.FloatType)};
  u.uHorizon.value.needsUpdate=true;
  u.uHorizonR={value:1};
  const cubeFragment=mobileFragment
    .replace("uniform float alpha;",[
      "uniform float alpha;",
      "uniform samplerCube uEnv;",
      "uniform float uEnvShore, uEnvRipple, uReliefTop, uReliefFar, uHorizonR;",
      "uniform vec3 uEnvCenter, uEnvSnow, uEnvRock;",
      "uniform sampler2D uHorizon;",
      "#define ENV_STEPS 20",
    ].join("\n"))
    .replace(/vec3 reflectionSample = [^;]+;/,[
      "vec3 envDir = reflect(-eyeDirection, normalize(vec3(surfaceNormal.x * uEnvRipple, 1.0, surfaceNormal.z * uEnvRipple)));", // oleaje suave: la normal plena desdibujaba la franja fina de montañas
      "envDir.y = abs(envDir.y);", // por debajo del horizonte no hay nada que reflejar
      "vec3 envLook = envDir;",
      "float envSeen = 1.0;",
      "vec3 envGuess = vec3(0.0);",
      "{",
      "  vec3 rd = normalize(vec3(envDir.x, max(envDir.y, 0.002), envDir.z));",
      "  float tEnd = min(max(uReliefTop * uReliefK - worldPosition.y, 0.0) / rd.y, uReliefFar);",
      "  float tPrev = 0.0, tHit = -1.0;",
      "  for (int i = 1; i <= ENV_STEPS; i++) {", // pasos crecientes: finos cerca de la orilla, largos lejos
      "    float s = float(i) / float(ENV_STEPS);",
      "    float t = tEnd * s * s;",
      "    vec3 p = worldPosition.xyz + rd * t;",
      "    vec2 ruv = p.xz / uCrop + 0.5;",
      "    if (any(lessThan(ruv, vec2(0.0))) || any(greaterThan(ruv, vec2(1.0)))) break;",
      "    if (p.y < reliefAt(ruv)) { tHit = t; break; }",
      "    tPrev = t;",
      "  }",
      "  if (tHit > 0.0) {",
      "    float a = tPrev, b = tHit;",
      "    for (int j = 0; j < 5; j++) {",
      "      float m = 0.5 * (a + b);",
      "      vec3 p = worldPosition.xyz + rd * m;",
      "      if (p.y < reliefAt(p.xz / uCrop + 0.5)) b = m; else a = m;",
      "    }",
      "    vec3 hitP = worldPosition.xyz + rd * b;",
      "    envLook = hitP - uEnvCenter;",
      // ¿Se veía ese punto desde la captura? Cara de espaldas al punto de captura, o algo del relieve en el medio.
      // Si no, el cubemap devuelve lo que lo tapaba (la roca de adelante repetida sobre el agua: reflejo
      // duplicado); en ese caso, tono de terreno estimado: nieve o roca según la pendiente, con el sol.
      "    vec2 hUv = hitP.xz / uCrop + 0.5;",
      "    vec2 cU = 1.0 / (uReliefSize - 1.0);",
      "    float h0 = reliefAt(hUv);",
      "    vec2 g = vec2(reliefAt(hUv + vec2(cU.x, 0.0)) - h0, reliefAt(hUv + vec2(0.0, cU.y)) - h0) / (uCrop * cU);",
      "    vec3 nH = normalize(vec3(-g.x, 1.0, -g.y));",
      "    vec3 toC = uEnvCenter - hitP;",
      "    float dC = length(toC);",
      "    vec3 dirC = toC / max(dC, 1e-3);",
      "    envSeen = dot(nH, dirC) > -0.05 ? 1.0 : 0.0;",
      // Relieve en el medio: el horizonte desde la captura en ese acimut, hasta un poco antes del punto (sin
      // contar su propia ladera), contra la elevación del punto. Antes era una marcha de 8 pasos cuadráticos que
      // se espaciaban justo cerca de la captura, donde están las rocas que más tapan (Brown): se las salteaba y su
      // reflejo se repetía sobre el agua lejos de ellas.
      "    vec2 hzD = hitP.xz - uEnvCenter.xz;",
      "    float hzR = length(hzD);",
      "    float hzQ = max(hzR - max(16.0, 0.03 * hzR), 0.0);",
      "    float hzTan = texture2D(uHorizon, vec2(atan(hzD.y, hzD.x) * 0.15915494 + 0.5, sqrt(hzQ / uHorizonR))).r;",
      "    envSeen *= 1.0 - smoothstep(-0.004, 0.004, hzTan - (hitP.y - uEnvCenter.y) / max(hzR, 1.0));",
      "    float rockK = smoothstep(0.7, 1.2, length(g));",
      "    envGuess = mix(uEnvSnow, uEnvRock, rockK) * (0.6 + 0.4 * max(dot(nH, sunDirection), 0.0));",
      "  } else {",
      // Sin impacto (cielo, o lo lejano fuera del recorte): la dirección directa supone el paisaje en el infinito,
      // pero desde la captura esa dirección puede chocar con relieve cercano (las rocas de al lado de Brown), que
      // aparecía repetido sobre el agua lejos de ellas. Por debajo del horizonte de la captura en ese acimut, se
      // la sube apenas por encima: cielo (o lo que asoma detrás del recorte).
      "    float hzFar = texture2D(uHorizon, vec2(atan(envDir.z, envDir.x) * 0.15915494 + 0.5, 1.0)).r + 0.01;",
      "    float hl = length(envDir.xz);",
      "    if (envDir.y < hzFar * hl) envLook = vec3(envDir.x, hzFar * hl, envDir.z);",
      "  }",
      "}",
      "vec3 reflectionSample = mix(envGuess, textureCube(uEnv, envLook).rgb, envSeen);", // mismo eje que la captura (comprobado contra el reflejo planar con el agua lisa)
      "vec2 envUv = worldPosition.xz / uCrop + 0.5;",
      "float envProx = step(0.0, envUv.x) * step(envUv.x, 1.0) * step(0.0, envUv.y) * step(envUv.y, 1.0) * texture2D(uShore, clamp(envUv, 0.0, 1.0)).g;",
      "vec3 envSky = mix(vec3(.24,.36,.44), vec3(.085,.16,.22), clamp(envDir.y, 0., 1.));",
      "reflectionSample = mix(reflectionSample, envSky, uEnvShore * smoothstep(0.75, 1.0, envProx));",
    ].join("\n"));
  type ReflectionMode="planar"|"cubo"|"cielo";
  let current:Terrain|undefined;
  const mirror=mesh.onBeforeRender;
  let waterSpeed=1.0;
  let mode:ReflectionMode="cielo",forced:ReflectionMode|null=null,tier:Tier=initial;
  let dirty=true,movingReflection=false,lastMirrorMs=-Infinity,mirrorRenders=0;
  const motionMirrorInterval=mobile?250:160;
  const world=new THREE.Matrix4(),projection=new THREE.Matrix4();
  // Cadencia del reflejo planar con la cámara en movimiento: se redibuja uno de cada `mirrorEvery` cuadros; en los
  // otros el agua reusa el último (mapeado con su propia matriz, así que no se desliza: solo queda una fracción de
  // cuadro atrasado). Al frenar, `pendingReflection` pide un cuadro más para que quede al día.
  let mirrorEvery=MIRROR_EVERY,moveFrames=0,stale=false,mirrorTarget:THREE.WebGLRenderTarget|null=null;
  // Horizonte del cubemap: se recalcula si cambia el terreno, el punto de captura o la exageración del relieve.
  let horizonKey="";
  function ensureHorizon(){
    const c=u.uEnvCenter.value as THREE.Vector3,k=u.uReliefK.value as number;
    if(!current||!u.uEnv.value)return;
    const key=`${current.relief.heights.length}|${current.widthM}|${c.x},${c.y},${c.z}|${k}`;
    if(key===horizonKey&&u.uHorizon.value.userData.terrain===current)return;
    horizonKey=key;
    const {width:mw,height:mh}=current.meshSize;
    const {texture,rMax}=buildHorizon(current.relief.heights,mw,mh,current.widthM,current.depthM,c,k);
    texture.userData.terrain=current;
    u.uHorizon.value.dispose();u.uHorizon.value=texture;u.uHorizonR.value=rMax;
  }
  mesh.onBeforeRender=(renderer,scene,camera,geometry,material,group)=>{
    if(mode==="cubo")ensureHorizon();
    if(mode!=="planar"){u.eye.value.setFromMatrixPosition(camera.matrixWorld);return;}
    if(!current)return;
    const now=performance.now();
    const motionDue=movingReflection&&now-lastMirrorMs>=motionMirrorInterval;
    const changed=!world.equals(camera.matrixWorld)||!projection.equals(camera.projectionMatrix);
    if(!dirty && !motionDue && !changed){stale=false;return;}
    if(!dirty && changed && mirrorEvery>1 && (++moveFrames%mirrorEvery)!==0){stale=true;return;}
    // Rendering the mirror must not mutate the main camera chunk instance buffers.
    if(!mirrorTarget){
      // El Water no expone su render target: se lo reconoce la primera vez que se dibuja en él (para poder cambiar
      // la resolución del reflejo sin recrear el agua).
      const set=renderer.setRenderTarget;
      let found:THREE.WebGLRenderTarget|null=null;
      renderer.setRenderTarget=function(this:THREE.WebGLRenderer,t,...rest){if(t&&!(t as {isWebGLCubeRenderTarget?:boolean}).isWebGLCubeRenderTarget&&t.texture===u.mirrorSampler.value)found=t as THREE.WebGLRenderTarget;return set.call(this,t,...rest);} as typeof set;
      try{mirror.call(mesh,renderer,scene,camera,geometry,material,group);}finally{renderer.setRenderTarget=set;}
      mirrorTarget=found as THREE.WebGLRenderTarget|null;
      if(mirrorTarget&&(mirrorTarget.width!==reflectionWidth||mirrorTarget.height!==reflectionHeight))mirrorTarget.setSize(reflectionWidth,reflectionHeight);
    }else mirror.call(mesh,renderer,scene,camera,geometry,material,group);
    mirrorRenders++;stale=false;
    world.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);dirty=false;lastMirrorMs=now;
  };
  // Alta: reflejo planar (segundo dibujo de la escena). Baja y media: cubemap si la base lo tiene; si no, como
  // antes (en celular planar, en escritorio el degradé de cielo).
  function quality(t:Tier) {
    tier=t;
    const env=!!u.uEnv.value;
    mode=forced ?? (t==="alta" ? "planar" : env ? "cubo" : mobile ? "planar" : "cielo");
    if(mode==="cubo"&&!env)mode="cielo";
    const fragment=mode==="planar" ? (mobile ? mobileFragment : desktopFragment) : mode==="cubo" ? cubeFragment : skyFragment;
    if(mat.fragmentShader!==fragment){mat.fragmentShader=fragment;mat.needsUpdate=true;}
    dirty=true;
  }
  quality(initial);
  return {mesh,quality,
    /** Cubemap precalculado de la base (null: sin él). */
    setEnvironment(t:THREE.CubeTexture|null,center?:[number,number,number]){u.uEnv.value?.dispose();u.uEnv.value=t;if(center)u.uEnvCenter.value.set(...center);quality(tier);},
    /** Para comparar: fuerza un modo de reflejo (null = el que corresponde a la calidad). */
    setReflectionMode(m:ReflectionMode|null){forced=m;quality(tier);},
    reflectionStats:()=>({modo:mode,pasesPlanares:mirrorRenders,cubemap:!!u.uEnv.value,resolucion:[reflectionWidth,reflectionHeight],cadencia:mirrorEvery}),
    /** El último cuadro reusó el reflejo: hace falta uno más para dejarlo al día (la cámara frenó). */
    pendingReflection:()=>stale&&mode==="planar",
    /** Para medir: redibujar el reflejo planar uno de cada `n` cuadros con la cámara en movimiento. */
    setReflectionCadence(n:number){mirrorEvery=Math.max(1,Math.round(n));moveFrames=0;},
    /** Lado mayor del reflejo planar (px), sin recrear el agua. */
    setReflectionResolution(px:number){const a=window.innerWidth/Math.max(1,window.innerHeight);reflectionWidth=Math.max(64,Math.round(px*Math.min(1,a)));reflectionHeight=Math.max(64,Math.round(px*Math.min(1,1/a)));mirrorTarget?.setSize(reflectionWidth,reflectionHeight);dirty=true;},
    disturb(position:THREE.Vector3,radius=50){ripples[nextRipple].set(position.x,position.z,radius,0);nextRipple=(nextRipple+1)%ripples.length;},
    stepRipples(dt:number){let active=false;for(const r of ripples){if(r.w<0)continue;r.w+=dt;if(r.w>=1.5)r.w=-1;else active=true;}return active;},
    setSpeed(value:number){waterSpeed=Math.max(.3,Math.min(1.6,value));},setWaves(value:number){u.uSilk.value=Math.max(.3,Math.min(1.5,value));},setSun(direction:THREE.Vector3,color:THREE.Color,direct:number,daylight:number){
    sun.copy(direction);
    u.sunDirection.value.copy(direction);
    u.sunColor.value.copy(color).multiplyScalar(direct);
    u.waterColor.value.setHex(WATER_COLOR).multiplyScalar(.1+.9*daylight);
    u.uShallowWater.value.setHex(SHALLOW_COLOR).multiplyScalar(.1+.9*daylight);
    dirty=true;
  },refresh:()=>{dirty=true;},motion:(active:boolean)=>{movingReflection=active;},time:(t:number,moving=false)=>{u.time.value=t*waterSpeed;movingReflection=moving;},
    bind(t:Terrain){
      if(current!==t){
        for(const r of ripples)r.w=-1;
        const domain=t.oceanDomain?.[diorama?"diorama":"landscape"];
        let geometry:THREE.BufferGeometry;
        if(domain){
          // Offline ADD clipping: low terrestrial depressions are not ocean.
          // Local plane XY becomes world XZ after the Water rotation.
          const sx=diorama?size*8:t.widthM,sy=diorama?size*8:t.depthM;
          const positions=new Float32Array(domain.positions.length/2*3);
          for(let i=0;i<domain.positions.length/2;i++){positions[i*3]=domain.positions[i*2]*sx;positions[i*3+1]=-domain.positions[i*2+1]*sy;}
          geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
          geometry.setIndex(domain.indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
        }else geometry=new THREE.PlaneGeometry(size*8,size*8);
        mesh.geometry.dispose();mesh.geometry=geometry;
        // Relieve para el paralaje del cubemap: alturas de la malla en R16F (filtrado lineal en WebGL 2, sin
        // convertir: se sube desde Float32).
        const {width:mw,height:mh}=t.meshSize,h=t.relief.heights;
        const relief=new THREE.DataTexture(h,mw,mh,THREE.RedFormat,THREE.FloatType);
        relief.internalFormat="R16F";relief.minFilter=relief.magFilter=THREE.LinearFilter;relief.generateMipmaps=false;relief.needsUpdate=true;
        u.uRelief.value.dispose();u.uRelief.value=relief;u.uReliefSize.value.set(mw,mh);
        let top=0;for(let i=0;i<h.length;i++)if(h[i]>top)top=h[i];
        u.uReliefTop.value=top;
        u.uReliefFar.value=Math.hypot(t.widthM,t.depthM);
      }
      u.uReliefK=t.relief.k; // mismo objeto que la exageración del terreno: sigue sus cambios sin rebind
      current=t;dirty=true;
      u.uShore.value=t.styleUniforms.uLight.value;u.uSurf.value=t.styleUniforms.uSurface.value;u.uCrop.value.set(t.widthM,t.depthM);}
  };
}

/**
 * Horizonte desde el punto de captura del cubemap, sobre las alturas de la malla (las mismas del paralaje):
 * para cada acimut (columna, atan2(dz, dx)) y distancia horizontal r (fila, √(r / rMax)), la tangente de la
 * elevación máxima del relieve visto desde `c` entre 4 m y r. Un punto a distancia r se veía desde la captura si su
 * propia tangente no queda por debajo. En CPU, una vez por terreno, punto y exageración (unas decenas de ms).
 */
function buildHorizon(h:Float32Array,mw:number,mh:number,widthM:number,depthM:number,c:THREE.Vector3,k:number){
  const AZ=1024,RB=512;
  const rMax=Math.max(...[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sz])=>Math.hypot(sx*widthM/2-c.x,sz*depthM/2-c.z)));
  const at=(x:number,z:number)=>{ // bilineal, como la textura del relieve (fuera del recorte: 0, mar)
    const fx=(x/widthM+0.5)*(mw-1),fz=(z/depthM+0.5)*(mh-1);
    if(fx<0||fz<0||fx>mw-1||fz>mh-1)return 0;
    const i=Math.min(Math.floor(fx),mw-2),j=Math.min(Math.floor(fz),mh-2),ax=fx-i,az=fz-j,o=j*mw+i;
    return (h[o]*(1-ax)+h[o+1]*ax)*(1-az)+(h[o+mw]*(1-ax)+h[o+mw+1]*ax)*az;
  };
  const data=new Float32Array(AZ*RB);
  for(let a=0;a<AZ;a++){
    const ang=((a+0.5)/AZ-0.5)*Math.PI*2,dx=Math.cos(ang),dz=Math.sin(ang);
    let best=-100,r=4,j=0;
    while(j<RB){
      const rj=rMax*((j+0.5)/RB)**2;
      while(r<=rj){best=Math.max(best,(at(c.x+dx*r,c.z+dz*r)*k-c.y)/r);r+=Math.min(4,Math.max(1,r*0.005));}
      data[j*AZ+a]=best;j++;
    }
  }
  // Última fila (horizonte completo del recorte, para los rayos sin impacto): máximo de ±3 acimuts, para que el
  // filtrado lineal entre columnas no baje la cima de un pico angosto y la dirección corregida no caiga en él.
  const last=(RB-1)*AZ,row=data.slice(last,last+AZ);
  for(let a=0;a<AZ;a++){let m=-100;for(let d=-3;d<=3;d++)m=Math.max(m,row[(a+d+AZ)%AZ]);data[last+a]=m;}
  const texture=new THREE.DataTexture(data,AZ,RB,THREE.RedFormat,THREE.FloatType);
  texture.internalFormat="R16F";texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;
  texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.ClampToEdgeWrapping;texture.needsUpdate=true;
  return {texture,rMax};
}
