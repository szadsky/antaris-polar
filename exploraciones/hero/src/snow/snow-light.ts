import * as THREE from "three";

// Luz y destellos de la nieve, compartidos por el terreno (shaders.ts) y los icebergs (icebergs.ts). Sin texturas
// ni otros módulos: se puede importar desde Node (scripts/check-icebergs.mjs).

/** Luz estilizada: tres zonas con transiciones suaves (sombra, medio tono, luz) en lugar del degradado de Lambert. */
export const STYL_RAMP = `float stylRamp(float ndl) {
  return smoothstep(0.0, 0.2, ndl) * 0.55 + smoothstep(0.3, 0.8, ndl) * 0.45;
}`;

/**
 * Cristales de hielo de la nieve: celdas de ~5 píxeles (potencia de 2 del tamaño en mundo, estable al
 * acercarse), una fracción (uSnowGlint.w) son cristales con una cara orientada al azar alrededor de la normal;
 * en la luz del sol solo brillan los que reflejan el sol hacia la cámara. Cada cristal es un punto chico como el
 * reflejo de un cristal de nieve (núcleo de ~1 px + brillo mínimo alrededor, centro al azar dentro de la celda,
 * recortado antes del borde: sin cuadrados), más intenso que el blanco de la nieve. Con celdas de 1,5 px eran
 * píxeles sueltos que se perdían; con 10 px y halo amplio, círculos demasiado grandes.
 * Usa vWorld, gN, gSnowK y uSnowGlint; escribe gGlit y gGlitN. Lo comparten el terreno y los icebergs.
 */

export const SNOW_GLINTS = `
{
  // lado corto del píxel en el mundo: en ángulo rasante, con el lado largo los destellos salían como rayitas
  float pxW = min(length(dFdx(vWorld)), length(dFdy(vWorld)));
  float sparkLod=log2(max(pxW * 5.0,0.02));
  float cellS=exp2(floor(sparkLod));
  float sparkBlend=smoothstep(0.0,1.0,fract(sparkLod));
  vec3 cid = floor(vWorld / cellS);
  vec3 hr = fract(sin(vec3(dot(cid, vec3(127.1, 311.7, 74.7)), dot(cid, vec3(269.5, 183.3, 246.1)), dot(cid, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
  vec3 cid2=floor(vWorld/(cellS*2.0));
  vec3 hr2=fract(sin(vec3(dot(cid2,vec3(127.1,311.7,74.7)),dot(cid2,vec3(269.5,183.3,246.1)),dot(cid2,vec3(113.5,271.9,124.6))))*43758.5453);
  vec3 facet = normalize(gN + (mix(hr.yzx,hr2.yzx,sparkBlend) * 2.0 - 1.0) * 0.45);
  gGlitN = normalize((viewMatrix * vec4(facet, 0.0)).xyz);
  vec3 c1 = (cid + 0.3 + 0.4 * hr.zxy) * cellS, c2 = (cid2 + 0.3 + 0.4 * hr2.zxy) * (cellS * 2.0);
  float d1 = length(vWorld - c1) / cellS, d2 = length(vWorld - c2) / (cellS * 2.0);
  float k1 = (exp(-d1 * d1 * 90.0) + 0.3 * exp(-d1 * d1 * 28.0)) * smoothstep(0.3, 0.18, d1);
  float k2 = (exp(-d2 * d2 * 90.0) + 0.3 * exp(-d2 * d2 * 28.0)) * smoothstep(0.3, 0.18, d2);
  gGlit = gSnowK * mix(step(hr.x,uSnowGlint.w) * k1, step(hr2.x,uSnowGlint.w) * k2, sparkBlend);
}`;

/** Sombra precalculada del sol: solo afecta a la luz directa; la luz ambiente sigue. */
export const SUN_SHADOW_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gSun;\n\t\tfloat ndlS = dot( geometryNormal, directLight.direction );\n\t\tif ( ndlS > 0.0 ) directLight.color *= mix( 1.0, stylRamp( ndlS ) / max( ndlS, 0.04 ), uStylize.x );" +
    // Luz que envuelve la sombra en la nieve (la nieve deja pasar algo de luz): el paso de luz a sombra es más
    // suave y la parte en sombra recibe un poco de luz azulada. Sin esto la nieve se veía como arcilla o plástico.
    "\n\t\tif ( gSnowK > 0.0 ) { float exS = max( ( ndlS + 0.35 ) / 1.35, 0.0 ) - max( ndlS, 0.0 ); reflectedLight.directDiffuse += directLight.color * exS * gSnowK * BRDF_Lambert( material.diffuseColor ) * vec3( 0.82, 0.9, 1.0 ); }" +
    // Reflejo del sol en la nieve: especular con Fresnel (de frente casi nada, rasante fuerte) + dispersión hacia
    // adelante (mirando al sol, ángulo rasante) + pocos destellos de cristales (cara alineada con el reflejo del sol).
    "\n\t\tif ( gSnowK > 0.0 && ndlS > 0.0 ) {" +
    "\n\t\t\tfloat aS = max( dot( geometryViewDir, reflect( -directLight.direction, geometryNormal ) ), 0.0 );" +
    "\n\t\t\tfloat frS = 0.1 + 0.9 * pow( 1.0 - max( dot( geometryNormal, geometryViewDir ), 0.0 ), 5.0 );" +
    "\n\t\t\tfloat fwd = pow( max( dot( -geometryViewDir, directLight.direction ), 0.0 ), 4.0 ) * pow( 1.0 - max( dot( geometryNormal, geometryViewDir ), 0.0 ), 2.0 );" +
    "\n\t\t\tfloat cr = pow( max( dot( geometryViewDir, reflect( -directLight.direction, gGlitN ) ), 0.0 ), 500.0 );" +
    "\n\t\t\treflectedLight.directSpecular += directLight.color * ndlS * ( gSnowK * ( uSnowGlint.x * frS * pow( aS, uSnowGlint.y ) + uSnowFwd * fwd ) + gGlit * uSnowGlint.z * cr );" +
    "\n\t\t}"
);
