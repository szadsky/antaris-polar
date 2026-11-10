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
export function createOcean(size:number,sun:THREE.Vector3,mobile:boolean,initial:Tier, expanded=false,maxAniso=1,diorama=false) {
  const aspect=window.innerWidth/Math.max(1,window.innerHeight);
  const longest=mobile?384:768;
  const reflectionWidth=Math.max(128,Math.round(longest*Math.min(1,aspect)));
  const reflectionHeight=Math.max(128,Math.round(longest*Math.min(1,1/aspect)));
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
  const officialFragment=mat.fragmentShader
    .replace("uniform float alpha;","uniform float alpha;\nuniform sampler2D uShore;\nuniform vec2 uCrop, uShoreLook;\nuniform vec3 uShallow;\nuniform float uShoreCurve, uSunGlint, uSilk;\nuniform vec2 uRipple;\nuniform vec3 uWater;\nuniform vec3 uGlintLobes;")
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
    // Todas las capas avanzan dentro de ±30° de un mismo viento, a distinta velocidad (las grandes más
    // rápido, SILK_SPEED en m por unidad de tiempo): el cruce cambia despacio, sin turbulencia.
    #define SILK_SCALE 2.5
    #define SILK_SPEED 1.0
    vec4 getNoise(vec2 uv) {
      vec2 bend=vec2(sin(dot(uv,vec2(.0061,.0037)/SILK_SCALE)+time*.05),sin(dot(uv,vec2(-.0029,.0071)/SILK_SCALE)-time*.04));
      uv+=21.0*SILK_SCALE*bend;
      mat2 r1=mat2(.9524,.3048,-.3048,.9524), r1b=mat2(.2588,-.9659,.9659,.2588);
      mat2 r2=mat2(.4226,-.9063,.9063,.4226), r2b=mat2(-.7660,.6428,-.6428,-.7660);
      vec2 w1=vec2(.940,.342), w2=vec2(.766,.643), w3=vec2(.985,-.174), w4=vec2(.866,.500);
      float sp=time*SILK_SPEED;
      vec3 sA=silkTex(r1*(uv-w1*sp*3.0)/(211.0*SILK_SCALE),SILK_BIAS);
      vec3 sB=silkTex(r1b*(uv-w3*sp*2.4)/(163.0*SILK_SCALE),SILK_BIAS);
      vec3 mA=silkTex(r2*(uv-w2*sp*1.9)/(83.0*SILK_SCALE),SILK_BIAS);
      float pixelFootprint=length(fwidth(uv));
      float mediumWeight=1.0-smoothstep(8.0,45.0,pixelFootprint);
      vec2 slopes=.45*(sA.xy*r1+sB.xy*r1b);
      #ifdef SILK_FINE
      vec3 mB=silkTex(r2b*(uv-w4*sp*1.6)/(67.0*SILK_SCALE),SILK_BIAS);
      slopes+=mediumWeight*.2*(mA.xy*r2+mB.xy*r2b);
      mat2 r3=mat2(-.5048,.8632,-.8632,-.5048);
      vec2 fuv=r3*(uv-w1*sp*1.2)/(31.0*SILK_SCALE);
      float fineK=.12*(1.0-smoothstep(.002,.01,length(fwidth(fuv))));
      slopes+=fineK*(silkTex(fuv,1.0).xy*r3);
      #else
      slopes+=mediumWeight*.38*(mA.xy*r2);
      #endif
      return vec4(slopes,mix(sA.z,mA.z,.38),1.0);
    }
  `;
  const noiseFn=/vec4 getNoise\( vec2 uv \) \{[\s\S]*?\n\t*\}/;
  const desktopFragment=officialFragment.replace(noiseFn,"#define SILK_FINE\n"+silkNoise);
  const mobileFragment=officialFragment.replace(noiseFn,silkNoise); // sin capa fina ni segunda capa media
  const skyFragment=mobileFragment.replace(/vec3 reflectionSample = [^;]+;/,
    "vec3 reflectionSample=mix(vec3(.24,.36,.44),vec3(.085,.16,.22),clamp(reflect(-eyeDirection,surfaceNormal).y,0.,1.));");  // A reflection only needs the silhouette and broad snow/rock tones.
  let current:Terrain|undefined;
  const mirror=mesh.onBeforeRender;
  let waterSpeed=.95;
  let high=false,dirty=true,movingReflection=false,lastMirrorMs=-Infinity;
  const motionMirrorInterval=mobile?250:160;
  const world=new THREE.Matrix4(),projection=new THREE.Matrix4();
  mesh.onBeforeRender=(renderer,scene,camera,geometry,material,group)=>{
    if(!high){u.eye.value.setFromMatrixPosition(camera.matrixWorld);return;}
    if(!current)return;
    const now=performance.now();
    const motionDue=movingReflection&&now-lastMirrorMs>=motionMirrorInterval;
    if(!dirty && !motionDue && world.equals(camera.matrixWorld)&&projection.equals(camera.projectionMatrix))return;
    // Rendering the mirror must not mutate the main camera chunk instance buffers.
    mirror.call(mesh,renderer,scene,camera,geometry,material,group);
    world.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);dirty=false;lastMirrorMs=now;
  };
  function quality(t:Tier) {
    high=mobile || t==="alta";
    const fragment=high ? (mobile ? mobileFragment : desktopFragment) : skyFragment;
    if(mat.fragmentShader!==fragment){mat.fragmentShader=fragment;mat.needsUpdate=true;}

    dirty=true;
  }
  quality(initial);
  return {mesh,quality,setSpeed(value:number){waterSpeed=Math.max(.3,Math.min(1.6,value));},setWaves(value:number){u.uSilk.value=Math.max(.3,Math.min(1.5,value));},setSun(direction:THREE.Vector3,color:THREE.Color,direct:number,daylight:number){
    sun.copy(direction);
    u.sunDirection.value.copy(direction);
    u.sunColor.value.copy(color).multiplyScalar(direct);
    u.waterColor.value.setHex(WATER_COLOR).multiplyScalar(.1+.9*daylight);
    dirty=true;
  },refresh:()=>{dirty=true;},motion:(active:boolean)=>{movingReflection=active;},time:(t:number,moving=false)=>{u.time.value=t*waterSpeed;movingReflection=moving;},
    bind(t:Terrain){
      if(current!==t){
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
      }
      current=t;dirty=true;
      u.uShore.value=t.styleUniforms.uLight.value;u.uCrop.value.set(t.widthM,t.depthM);}
  };
}
