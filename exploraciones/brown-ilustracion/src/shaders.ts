import {snowInteractionUniforms,TRACK_PARS,TRACK_VERTEX,TRACK_NORMAL} from './snow-interaction';
import {paintUniforms,PAINT_PARS,PAINT_COLOR} from "./paint-style";
import * as THREE from "three";
import { detailTexture, lin, noiseTexture, type SharedTextures } from "./materials";
import { detailTextureCorrected } from "./detail-corrected";
import { terrainTextureUniforms } from "./terrain-textures";
import { snowVolumeUniforms, SNOW_VOL_VERTEX_PARS, SNOW_VOL_COMMON, SNOW_VOL_VERTEX, SNOW_VOL_FRAG_FN, COAST_RAMP_VERTEX } from "./snow-volume";

/**
 * Materiales del terreno. Dos estilos sobre las mismas texturas calculadas:
 *  - BASE: sombreado de exploraciones/terreno-nitidez, para medir el antes.
 *  - ESTILIZADO: interpretación artística basada en REMA (fase 1).
 * Y dos caminos de vértices:
 *  - malla única (fase 1, `?geo=completa`);
 *  - bloques con LOD (fase 2): plantilla compartida + altura leída de textura.
 */

// ─── Camino de vértices ─────────────────────────────────────
export interface GridUniforms {
  uHeight: { value: THREE.DataTexture };
  uGridSize: { value: THREE.Vector2 };
  uTexSize: { value: THREE.Vector2 };
  uCell: { value: number };
  uStride: { value: number };
  uK: { value: number };
}

// `position.xy` = celdas dentro del bloque, `position.z` = 1 en el faldón.
// El atributo instanciado `chunk` es el origen del bloque (celdas de malla).
const GRID_VERTEX_PARS = `
uniform highp sampler2D uHeight;
uniform vec2 uGridSize, uTexSize;
uniform float uCell, uStride, uK, uSkirt;
attribute vec2 chunk;
#define SNOW_K uK`;

const GRID_BEGIN_VERTEX = `
vec2 cr = min(chunk + position.xy, uGridSize - 1.0);
float hgt = texelFetch(uHeight, ivec2(cr), 0).r * uK - position.z * uSkirt * float(all(greaterThan(cr, vec2(0.0))) && all(lessThan(cr, uGridSize - 1.0)));
vec3 transformed = vec3(cr.x * uCell - (uGridSize.x - 1.0) * uCell * 0.5, hgt, cr.y * uCell - (uGridSize.y - 1.0) * uCell * 0.5);
vSurfUv = (cr * uStride + 0.5) / uTexSize;`;

export interface VertexPath {
  exactCoast?: boolean;
  grid?: GridUniforms;
  /** Profundidad del faldón (m): tapa las uniones entre bloques de distinto nivel. */
  skirt?: { value: number };
}

function vertexPath(s: THREE.WebGLProgramParametersWithUniforms, v: VertexPath, extraPars = "") {
  extraPars += "\nvarying vec3 vClosureNormal;";
  s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vClosureNormal;");
  if (v.grid) {
    Object.assign(s.uniforms, v.grid, { uSkirt: v.skirt ?? { value: 0 } });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vSurfUv;${GRID_VERTEX_PARS}${extraPars}`)
      .replace("#include <begin_vertex>", GRID_BEGIN_VERTEX + "\nvClosureNormal = vec3(0.0);");
  } else {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 surfUv;\nvarying vec2 vSurfUv;\n#define SNOW_K 1.0${extraPars}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfUv = surfUv;\nvClosureNormal = normal.y == 0.0 ? mat3(modelMatrix) * normal : vec3(0.0);");
  }
}

// ─── BASE ───────────────────────────────────────────────────
export function baseMaterial(tex: SharedTextures, v: VertexPath = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  if (v.exactCoast) (m as THREE.MeshStandardMaterial & {defines: Record<string,string>}).defines = { STANDARD: "", EXACT_COAST: "" };
  const uniforms = {
    uSurface: { value: tex.surface },
    uSnow: { value: lin("#eef3f6") },
    uRock: { value: lin("#4a4643") },
    uSea: { value: lin("#1d3a4c") },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    vertexPath(s, v);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uSurface;\nuniform vec3 uSnow, uRock, uSea;\nvarying vec2 vSurfUv;")
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "vec4 surf = texture2D(uSurface, vSurfUv);",
          "#ifndef EXACT_COAST", "if (surf.a < 0.05) discard;", "#endif",
          "vec3 nDet = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);",
          "nDet.y = sqrt(max(0.0, 1.0 - dot(nDet.xz, nDet.xz)));",
          "if(dot(vClosureNormal,vClosureNormal)>0.5) nDet = normalize(vClosureNormal);",
          "vec3 ground = mix(uSnow, uRock, smoothstep(0.18, 0.42, 1.0 - nDet.y));",
          "float sdfM = (surf.a * 255.0 - 128.0) / 8.0;",
          "float aaW = max(fwidth(sdfM) * 0.75, 0.05);",
          "float isSea = 1.0 - smoothstep(-aaW, aaW, sdfM);",
          "#ifdef EXACT_COAST", "isSea = 0.0;", "#endif",
          "diffuseColor.rgb = mix(ground, uSea, isSea) * mix(1.0, surf.b, 1.0 - isSea);",
        ].join("\n")
      )
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(nDet, 0.0)).xyz);");
  };
  return m;
}

// ─── ESTILIZADO ─────────────────────────────────────────────
export interface StyleParams {
  halfSize: [number, number];
  seaY: number;
}

/** Uniforms del estilo, compartidos por todas las variantes (cerca, lejos, plano del mar). */
export function styleUniforms(tex: SharedTextures, p: StyleParams) {
  return {
    ...paintUniforms(),
    ...snowInteractionUniforms,
    uSurface: { value: tex.surface },
    uLight: { value: tex.light },
    uNoise: { value: noiseTexture() },
    // Fase 3A: detalle de cerca (normales generadas; interpretación). 1 = activo.
    uDetail: { value: detailTexture() },
    uDetailN: { value: detailTextureCorrected() },
    // Textura KTX2 de nieve (compartida por todo el terreno).
    ...terrainTextureUniforms,
    // Volumen de la nieve (src/snow-volume.ts): relieve compartido, desplazamiento y normal.
    ...snowVolumeUniforms(),
    // Capa media de la textura de roca: x = metros por mosaico · y = intensidad (0 = no se lee).
    uRockMacro: { value: new THREE.Vector2(90, 0) }, // capa de color de 90 m apagada: manchaba la roca
    // Relieve REMA en la roca por la curvatura con signo (canal B de la textura de luz):
    // x = oscurecer surcos · y = peso de la normal de la capa media de la textura (90 m) · z = aclarar crestas.
    uRockRelief: { value: new THREE.Vector3(0.4, 0, 0.1) }, // surcos 0,9 → 0,4: bandas oscuras
    // Volumen de la nieve por la misma curvatura REMA: surcos algo más sombreados y fríos.
    // Nieve: y = oclusión de hondonadas (cavidades); x, z, w sin uso.
    uSnowLook: { value: new THREE.Vector4(0, 0.5, 0, 0) }, // hondonadas al 50 % (al 100 % manchaban la nieve)
    // Reflejo del sol en la nieve (GLSL, en la luz directa del sol), como la nieve real:
    // x = satinado especular amplio · y = su exponente · z = destellos de cristales · w = densidad de cristales.
    uSnowGlint: { value: new THREE.Vector4(0.055, 28, 0.65, 0.18) },
    // Dispersión hacia adelante: la nieve brilla más mirando hacia el sol con ángulo rasante.
    uSnowFwd: { value: 0.16 },
    uSnowRelief: { value: 0 }, // apagado en el estilizado: moteaba la nieve; el volumen lo da la luz en bandas
    // Fracturas de la roca: intensidad del relieve de detalle generado (el de la prueba C, 0 bytes de
    // descarga) sobre la roca, solo de cerca. 0 = sin fracturas.
    uRockFrac: { value: 0.6 }, // 1,7 se veía rugosa
    // Estilizado: x = luz en bandas suaves (0 = Lambert realista, 1 = bandas) · y = suavizado de las
    // normales REMA para el sombreado (sesgo de mipmap; la geometría no cambia) · z = suavizado extra
    // de las normales solo en la nieve ·
    // w = microrelieve de la nieve (Snow007A).
    uStylize: { value: new THREE.Vector4(0, 0.5, 2.0, 0.35) }, // roca: normal REMA con sesgo 0,5 (formas reales) · nieve: sesgo 2 (≈ 16 m), lisa: con 0,5 se veía rugosa
    // Tono de la roca: x = luminancia media lineal objetivo (gris mineral) · y = fracción del color de la
    // foto · z = cuánto se conservan las zonas más claras que la media (1 = todas; menos = sin vetas blancas).
    uRockTone: { value: new THREE.Vector3(0.17, 0, 0.3) },
    // Metros por mosaico: roca 12,66 m (Marble Cliff 04, tamaño real publicado); nieve 5 m (Snow007A:
    // escala artística para que el grano se lea desde la cámara; la fuente no publica el tamaño real).
    uTexScale: { value: new THREE.Vector2(12.66, 2.5) }, // nieve 5 → 2,5 m e intensidad 1 → 0,35 (uStylize.w): Snow007A se veía arrugada
    // Roca: normal ×2, contraste ×1,6, gradientes ×0,6 (mipmap más nítido a media distancia);
    // borde nieve-roca con ±0,02 de pendiente (definido, sin recorte duro).
    // Textura nítida (mipmap estándar, contraste 1, normal 0,9); el moteado blanco lo evita uRockTone.z
    // (zonas claras al 30 %) y la definición la dan los surcos REMA y las fracturas (uRockFrac).
    uRockLook: { value: new THREE.Vector4(0.4, 1, 1, 0.006) }, // borde nieve-roca neto (0,02 → 0,006): de cerca la roca se desvanecía en la nieve como una mancha
    uDetailOn: { value: 1 },
    // Capas de diagnóstico (no cambian nada con los valores por defecto):
    // uColorVar = variación de color (cavidades, manchas, vetas); uDetailGain = intensidad del detalle.
    uColorVar: { value: 1 },
    uDetailGain: { value: 1 },
    uDetailFade: { value: new THREE.Vector2(500, 2200) },
    uHalf: { value: new THREE.Vector2(...p.halfSize) },
    uSeaY: { value: p.seaY },
    // Solo la última franja de ~60 m baja al mar (cierra el borde); el resto del borde
    // se disuelve en la niebla por color, sin tocar el relieve.
    uEdgeFade: { value: 60 },
    uEdgeHaze: { value: 350 },
    uSnow: { value: lin("#e3e7ea") }, // antes #f3f6f8: al sol quedaba casi saturada y no se leía el volumen
    uSnowShade: { value: lin("#c9d9e6") },
    uRockA: { value: lin("#4a4d52") },
    uRockB: { value: lin("#8e9196") },
    uIce: { value: lin("#9fd3e6") },
    // Océano Austral azul petróleo oscuro (antes #14303f / #2b5a6b).
    uSeaDeep: { value: lin("#244453") },
    uSeaShallow: { value: lin("#346271") },
    // Agua (estilizada, sin simulación): x = pendiente de las ondas · y = reflejo del cielo (Fresnel)
    // · z = velocidad de las ondas (0 = quietas) · w = rugosidad del agua.
    uSeaLook: { value: new THREE.Vector4(0.05, 0.3, 0.5, 0.22) },
    uSky: { value: lin("#a6c8e6") },
    // Fondo bajo el agua (reconstrucción artística): color en la orilla y profundidades (m) a las que
    // pasa a turquesa (x) y a azul profundo (y).
    uSeaBed: { value: lin("#a3aca6") }, // antes casi negro: orillas demasiado oscuras
    uSeaBedDepth: { value: new THREE.Vector2(16, 30) }, // transición más gradual (antes 9 m)
    uShoreBand: { value: 1 }, // 1: la franja de la línea de agua usa el color del fondo (no el del mar profundo)
    uSeaBedMid: { value: lin("#5d6965") }, // gris verdoso claro (turquesa: muy azul; #3a4644: muy oscuro) // color intermedio del fondo (a uSeaBedDepth.x) // mismo cielo que el fondo
    uTime: { value: 0 },
    uFoam: { value: lin("#dfeef3") },
  };
}
export type StyleUniforms = ReturnType<typeof styleUniforms>;

const STYLE_FRAG_PARS = `${PAINT_PARS}
${TRACK_PARS}
uniform sampler2D uSurface, uLight, uNoise, uDetail, uDetailN, uSnowNor, uRockCol, uRockNor;
uniform vec2 uRockMacro;
uniform vec3 uRockMean;
uniform float uDetailOn, uColorVar, uDetailGain;
uniform vec2 uDetailFade, uTexScale;
// Aspecto de la roca: x = intensidad de la normal · y = contraste del color · z = escala de gradientes
// (< 1: mipmap algo más nítido a media distancia) · w = ancho del borde nieve-roca.
uniform vec4 uRockLook;
uniform vec3 uRockTone;
uniform vec3 uRockRelief;
uniform float uRockFrac;
uniform vec4 uStylize;
uniform vec4 uSnowLook;
uniform vec4 uSnowGlint;
uniform float uSnowFwd;
uniform float uSnowRelief;
uniform sampler2D uSnowVol;
uniform vec4 uSnowDisp;
uniform vec3 uSnowVolK;
uniform float uSnowCliff;
uniform vec2 uSnowBank;
uniform vec4 uSnowForm;
uniform vec2 uSnowFormR;
uniform vec3 uSnow, uSnowShade, uRockA, uRockB, uIce, uSeaDeep, uSeaShallow, uFoam;
uniform float uSeaY, uEdgeHaze;
uniform vec3 uSeaBed, uSeaBedMid;
uniform vec2 uSeaBedDepth;
uniform float uShoreBand;
uniform vec4 uSeaLook;
uniform vec3 uSky;
uniform float uTime;
uniform vec2 uHalf;
varying vec3 vWorld;
float gSun = 1.0;
float gRough = 0.8;
float gPaintRock = 0.0;
vec3 gN = vec3(0.0, 1.0, 0.0);
vec3 gRefl = vec3(0.0);
float gSnowK = 0.0, gGlit = 0.0; // máscara de nieve y de cristales para el reflejo del sol (luz directa)
vec3 gGlitN = vec3(0.0, 0.0, 1.0); // normal (espacio de vista) del cristal de este píxel
// Luz estilizada: tres zonas con transiciones suaves (sombra, medio tono, luz) en lugar del degradado
// de Lambert. Devuelve el factor que reemplaza a dot(N, L).
${SNOW_VOL_COMMON}
${SNOW_VOL_FRAG_FN}
float stylRamp(float ndl) {
  return smoothstep(0.0, 0.2, ndl) * 0.55 + smoothstep(0.3, 0.8, ndl) * 0.45;
}
// Ondas del agua: suma de 5 ondas direccionales (solo la normal, sin desplazar geometría), de 6 a 41 m.
// Cada onda se apaga cuando su longitud baja de ~10 píxeles (sin franjas ni parpadeo a la distancia).
vec3 seaNormal(vec3 p) {
  if (uSeaLook.x <= 0.0) return vec3(0.0, 1.0, 0.0);
  float t = uTime * uSeaLook.z;
  float px = max(length(fwidth(p.xz)), 1e-3);
  vec2 g = vec2(0.0);
  vec2 d; float k, fd;
  d = vec2(0.94, 0.34);   k = 6.2832 / 41.0; fd = clamp(1.0 - k * px * 1.5, 0.0, 1.0); g += d * cos(dot(d, p.xz) * k + t * sqrt(9.8 * k)) * 1.0 * fd;
  d = vec2(0.62, -0.78);  k = 6.2832 / 27.0; fd = clamp(1.0 - k * px * 1.5, 0.0, 1.0); g += d * cos(dot(d, p.xz) * k + t * sqrt(9.8 * k) + 1.7) * 0.8 * fd;
  d = vec2(-0.21, 0.98);  k = 6.2832 / 17.0; fd = clamp(1.0 - k * px * 1.5, 0.0, 1.0); g += d * cos(dot(d, p.xz) * k + t * sqrt(9.8 * k) + 4.1) * 0.6 * fd;
  d = vec2(0.99, -0.12);  k = 6.2832 / 10.0; fd = clamp(1.0 - k * px * 1.5, 0.0, 1.0); g += d * cos(dot(d, p.xz) * k + t * sqrt(9.8 * k) + 2.3) * 0.45 * fd;
  d = vec2(-0.71, -0.70); k = 6.2832 / 6.3;  fd = clamp(1.0 - k * px * 1.5, 0.0, 1.0); g += d * cos(dot(d, p.xz) * k + t * sqrt(9.8 * k) + 5.2) * 0.3 * fd;
  g *= uSeaLook.x;
  return normalize(vec3(-g.x, 1.0, -g.y));
}
// Reflejo aproximado del cielo (Fresnel de Schlick con un color de cielo fijo): sin reflejos planares.
vec3 seaReflection(vec3 nrm, vec3 p) {
  vec3 vd = normalize(cameraPosition - p);
  float f = 0.02 + 0.98 * pow(1.0 - max(dot(nrm, vd), 0.0), 5.0);
  return uSky * f * uSeaLook.y;
}
vec2 triNoise(vec3 p, vec3 n, float f) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uNoise, p.zy * f).rg * w.x + texture2D(uNoise, p.xz * f).rg * w.y + texture2D(uNoise, p.xy * f).rg * w.z;
}
#if defined(MAT_C) || defined(MAT_N)
// Muestreo aperiódico: técnica 3 de I. Quílez ("texture repetition"), tal como la usa
// three-landscape (MIT, nwpointer/three-landscape, util/samplers.js). Agregado nuestro: cada
// patrón virtual además se gira, para que las ondas de nieve no tengan una sola dirección.
// Devuelve las normales de detalle ya decodificadas y vueltas al plano del mundo: rg = roca, ba = nieve.
vec4 aperiodicDetail(sampler2D map, vec2 uv, float k) {
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l), ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia), offb = sin(vec2(3.0, 7.0) * ib);
  float ra = ia * 2.39996, rb = ib * 2.39996;
  mat2 Ra = mat2(cos(ra), sin(ra), -sin(ra), cos(ra));
  mat2 Rb = mat2(cos(rb), sin(rb), -sin(rb), cos(rb));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 a = textureGrad(map, Ra * uv + offa, Ra * dx, Ra * dy) * 2.0 - 1.0;
  vec4 b = textureGrad(map, Rb * uv + offb, Rb * dx, Rb * dy) * 2.0 - 1.0;
  // de vuelta al plano del mundo: inversa de la rotación (transpuesta)
  mat2 Ta = mat2(Ra[0][0], Ra[1][0], Ra[0][1], Ra[1][1]);
  mat2 Tb = mat2(Rb[0][0], Rb[1][0], Rb[0][1], Rb[1][1]);
  a = vec4(Ta * a.xy, Ta * a.zw);
  b = vec4(Tb * b.xy, Tb * b.zw);
  return mix(a, b, smoothstep(0.2, 0.8, f));
}
#endif
#ifdef MAT_N
// ─── Material de roca y nieve con texturas (técnicas de three-landscape, adaptadas) ───
// Muestreo aperiódico: técnica 3 de I. Quílez, como en three-landscape (MIT, util/samplers.js):
// un ruido k elige dos de ocho desplazamientos y se mezclan dos lecturas. Con gradientes
// explícitos (textureGrad) se puede llamar dentro de ramas sin romper el mipmap.
vec4 aper(sampler2D m, vec2 uv, vec2 gx, vec2 gy, float k) {
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l), ib = ia + 1.0;
  vec4 a = textureGrad(m, uv + sin(vec2(3.0, 7.0) * ia), gx, gy);
  vec4 b = textureGrad(m, uv + sin(vec2(3.0, 7.0) * ib), gx, gy);
  return mix(a, b, smoothstep(0.2, 0.8, f));
}
// Normal de la textura (OpenGL) con intensidad, y mezcla RNM (reoriented normal mapping) sobre
// la normal del relieve, por plano de proyección (como en el triplanar de B. Golus).
vec3 tnUnpack(vec4 s, float str) {
  vec2 xy = (s.xy * 2.0 - 1.0) * str;
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
vec3 rnm(vec3 n1, vec3 n2) {
  n1 += vec3(0.0, 0.0, 1.0);
  n2 *= vec3(-1.0, -1.0, 1.0);
  return n1 * dot(n1, n2) / n1.z - n2;
}
// Proyección biplanar: pesos por la normal REMA (potencia 4) y sin el eje más débil → sin
// estiramiento en pendientes y como mucho dos planos por textura.
vec3 gBw;
vec2 gUvX, gUvY, gUvZ, gGXx, gGXy, gGYx, gGYy, gGZx, gGZy;
float gK;
float gGrad = 1.0;
vec3 biColor(sampler2D m, float s) {
  vec3 c = vec3(0.0);
  if (gBw.x > 0.0) c += aper(m, gUvX * s, gGXx * s * gGrad, gGXy * s * gGrad, gK).rgb * gBw.x;
  if (gBw.y > 0.0) c += aper(m, gUvY * s, gGYx * s * gGrad, gGYy * s * gGrad, gK).rgb * gBw.y;
  if (gBw.z > 0.0) c += aper(m, gUvZ * s, gGZx * s * gGrad, gGZy * s * gGrad, gK).rgb * gBw.z;
  return c;
}
vec3 biNormal(sampler2D m, vec3 n, float s, float str) {
  vec3 o = vec3(0.0);
  if (gBw.x > 0.0) { vec3 t = rnm(vec3(n.zy, abs(n.x)), tnUnpack(aper(m, gUvX * s, gGXx * s * gGrad, gGXy * s * gGrad, gK), str)); t.z *= n.x < 0.0 ? -1.0 : 1.0; o += t.zyx * gBw.x; }
  if (gBw.y > 0.0) { vec3 t = rnm(vec3(n.xz, abs(n.y)), tnUnpack(aper(m, gUvY * s, gGYx * s * gGrad, gGYy * s * gGrad, gK), str)); t.z *= n.y < 0.0 ? -1.0 : 1.0; o += t.xzy * gBw.y; }
  if (gBw.z > 0.0) { vec3 t = rnm(vec3(n.xy, abs(n.z)), tnUnpack(aper(m, gUvZ * s, gGZx * s * gGrad, gGZy * s * gGrad, gK), str)); t.z *= n.z < 0.0 ? -1.0 : 1.0; o += t.xyz * gBw.z; }
  return normalize(o);
}
#endif
vec3 seaColor(float shore, float fine, out float foam) {
  // Espuma angosta (~10 m) y cortada por ruido: de cerca no debe leerse como una plataforma.
  foam = smoothstep(0.966, 0.995, shore) * smoothstep(0.50, 0.76, fine);
  vec3 sea = mix(uSeaDeep, uSeaShallow, 0.42 * smoothstep(0.78, 0.98, shore));
  return mix(sea, uFoam, foam * 0.48);
}`;

const STYLE_COLOR = `
vec4 surf = texture2D(uSurface, vSurfUv);
#ifndef EXACT_COAST
if (surf.a < 0.05) discard; // sin dato
#endif
// Tierra / agua: distancia con signo a la costa ADD (m, + tierra), interpolada entre texeles; el
// borde se recorta a ~1 píxel (fwidth): sin escalones de la grilla de 4 m (dientes de sierra).
float sdfM = (surf.a * 255.0 - 128.0) / 8.0;
float aaW = max(fwidth(sdfM), 0.05);
float isSea = (1.0 - smoothstep(-aaW, aaW, sdfM)) * (1.0 - smoothstep(0.1, 1.0, vWorld.y - uSeaY));
#ifdef EXACT_COAST
isSea = 0.0;
#endif
vec4 lgt = texture2D(uLight, vSurfUv);
vec3 n = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);
#ifdef MAT_N
// Estilizado: formas más simples y menos rugosas. Normal REMA de un mipmap más grueso (sesgo
// uStylize.y: 1,5 ≈ 11 m), solo para el sombreado y la clasificación; la geometría no cambia.
float cavS = surf.b;
if (uStylize.y > 0.0) {
  vec4 surfS = texture2D(uSurface, vSurfUv, uStylize.y);
  n.xz = surfS.rg * 2.0 - 1.0;
  cavS = surfS.b; // cavidades también suavizadas: nieve sin moteado
}
#endif
n.y = sqrt(max(0.0, 1.0 - dot(n.xz, n.xz)));
// Vertical closure faces need their geometric normal, not the overhead DEM normal.
bool closureFace = dot(vClosureNormal, vClosureNormal) > 0.5;
if (closureFace) n = normalize(vClosureNormal);
#ifdef SNOW_VOL_FRAG
// Paredes de la malla (el frente de un acantilado costero entre la cima y el fondo): la normal REMA cenital
// dice "plano" y las pintaba de nieve, con vetas verticales de la proyección desde arriba. Donde la cara es
// mucho más empinada que lo que dice REMA, se usa la normal de la cara (en laderas donde coinciden, nada).
float wallK = 0.0; // 0 = superficie, 1 = pared (frente de acantilado)
// Solo en la franja costera (distancia a la costa sin saturar, ±16 m): tierra adentro las laderas rugosas
// también difieren de la normal suavizada y se facetaban. Se compara contra la normal REMA de 4 m.
float coastK = closureFace ? 0.0 : uSnowDisp.w * (1.0 - smoothstep(12.0, 15.5, abs(sdfM)));
vec3 nGeo = normalize(cross(dFdx(vWorld), dFdy(vWorld))); // fuera del if: derivadas en flujo uniforme
if (dot(nGeo, cameraPosition - vWorld) < 0.0) nGeo = -nGeo;
if (coastK > 0.0) {
  vec2 nF0 = surf.rg * 2.0 - 1.0;
  wallK = coastK * smoothstep(0.15, 0.35, (1.0 - abs(nGeo.y)) - (1.0 - sqrt(max(0.0, 1.0 - dot(nF0, nF0)))));
  // Solo por encima de 6–12 m sobre el agua: en orillas bajas y medianas, las caras hacia el fondo se pasaban
  // a roca y la silueta salía en dientes. (Con el relieve REMA suavizado no se distinguía: REMA rellena el mar.)
  wallK *= smoothstep(6.0, 12.0, vWorld.y - uSeaY);
  if (wallK > 0.0) {
    // Dirección horizontal suave: gradiente de la distancia con signo a la costa (continua a lo largo del
    // frente); la cara triangular solo aporta la inclinación. Con la normal de la cara sola, columnas facetadas.
    // mipmap grueso (~64 m) y paso de 16 texeles: sobre la pared la uv salta entre la cima y el fondo de un
    // triángulo a otro, y la distancia se recorta a ±16 m (sin gradiente mar adentro); con lecturas finas
    // la dirección cambiaba (o caía en la normal facetada) en cada columna.
    vec2 ts = 16.0 / vec2(textureSize(uSurface, 0));
    vec2 sg = vec2(textureLod(uSurface, vSurfUv + vec2(ts.x, 0.0), 4.0).a - textureLod(uSurface, vSurfUv - vec2(ts.x, 0.0), 4.0).a,
                   textureLod(uSurface, vSurfUv + vec2(0.0, ts.y), 4.0).a - textureLod(uSurface, vSurfUv - vec2(0.0, ts.y), 4.0).a);
    vec3 nW = nGeo;
    if (abs(sg.x) + abs(sg.y) > 0.0005) {
      vec2 hd = normalize(-sg) * length(nGeo.xz);
      nW = normalize(vec3(hd.x, nGeo.y * 0.25, hd.y)); // casi horizontal: sin proyección desde arriba (vetas)
    }
    n = normalize(mix(n, nW, wallK));
  }
}
#endif
float steep = 1.0 - n.y;
#ifdef MAT_N
// Nieve estilizada: normal REMA aún más suavizada (sesgo uStylize.z, 3 ≈ 32 m) solo para sombrear la
// nieve: superficies amplias y limpias, sin las ondulaciones de 20–40 m. La roca usa n.
vec3 nSm = n;
#ifdef SNOW_VOL_FRAG
// Nieve de cerca: con la textura de normales ampliada (texel de 4 m más grande que ~1 píxel), filtrado
// bicúbico B-spline (4 lecturas) en vez de bilineal: sin cuadrados en la luz. Lejos, una lectura con sesgo.
vec2 duvS = vSurfUv * vec2(textureSize(uSurface, 0));
float lodS = log2(max(max(length(dFdx(duvS)), length(dFdy(duvS))), 1e-4));
float bicK = 1.0 - smoothstep(1.5, 2.5, lodS + uStylize.z); // de cerca: bicúbico sobre el mip suavizado (2)
vec4 surfBic = vec4(0.0);
if (!closureFace) {
  if (bicK > 0.0) {
    surfBic = texBSpline(uSurface, vSurfUv, 2); // normal y cavidad del mip 2 (≈ 16 m), sin cuadrados ni rugosidad
    nSm.xz = mix(texture2D(uSurface, vSurfUv, uStylize.z).rg, surfBic.rg, bicK) * 2.0 - 1.0;
  } else {
    nSm.xz = texture2D(uSurface, vSurfUv, uStylize.z).rg * 2.0 - 1.0;
  }
  nSm.y = sqrt(max(0.0, 1.0 - dot(nSm.xz, nSm.xz)));
}
#else
if (uStylize.z > 0.0 && !closureFace) {
  nSm.xz = texture2D(uSurface, vSurfUv, uStylize.z).rg * 2.0 - 1.0;
  nSm.y = sqrt(max(0.0, 1.0 - dot(nSm.xz, nSm.xz)));
}
#endif
#endif
#ifdef MAT_N
float cav = cavS;
#ifdef SNOW_VOL_FRAG
// cavidad bicúbica de cerca (la de 4 m, bilineal y al 100 %, marcaba cuadrados en la nieve)
if (bicK > 0.0 && !closureFace) cav = mix(cav, surfBic.b, bicK);
#endif
#else
float cav = surf.b;
#endif
// DEM cavity/curvature and baked overhead shadow describe the top surface only.
if (closureFace) cav = 1.0;
#ifdef SNOW_VOL_FRAG
cav = mix(cav, 1.0, wallK); // cavidad, sombra y curvatura cenitales no describen una pared
#endif
float shore = lgt.g;
gSun = closureFace ? 1.0 : lgt.r;
#ifdef SNOW_VOL_FRAG
gSun = mix(gSun, 1.0, wallK);
#endif
#if defined(MAT_B) || defined(MAT_C) || defined(MAT_N)
// B/C/N: una sola lectura cenital de baja frecuencia (mosaico de 1900 m):
// R = manchas suaves (~240 m), G = vetas fbm (~30–120 m).
vec2 mac = texture2D(uNoise, vWorld.xz * (1.0 / 1900.0)).rg;
float big = mac.r;
float fine = mac.g;
#ifdef SNOW_VOL_FRAG
// Volumen de la nieve: normal del mismo relieve que desplaza la geometría (misma máscara de pendiente,
// costa y nivel del mar), más ondulaciones finas solo en la luz. Reconstrucción artística. La zona de
// acumulación reutiliza big (el mismo ruido de 1900 m que el vertex shader).
// lejos (> 2–3,5 km) el relieve no se distingue: sin lecturas (las vistas generales no pagan el costo)
// luz del relieve hasta ~50° (la nieve se sostiene en laderas de 30–45°; con el corte a ~35° casi no se veía)
float snowVolM = closureFace ? 0.0 : uSnowDisp.w * (1.0 - smoothstep(0.25, 0.42, steep)) * smoothstep(4.0, 12.0, sdfM) * smoothstep(1.0, 6.0, vWorld.y - uSeaY) * (1.0 - smoothstep(2000.0, 3500.0, length(cameraPosition - vWorld)));
vec2 dpxV = dFdx(vWorld.xz), dpyV = dFdy(vWorld.xz); // fuera del if: flujo uniforme
if (snowVolM > 0.0) {
  vec2 gS = snowVolGrad(vWorld.xz, snowVolZone(vWorld.xz), dpxV, dpyV);
  nSm = normalize(nSm - vec3(gS.x, 0.0, gS.y) * snowVolM);
}
#endif
#else
// A: variación procedural triplanar: manchas cada ~700 m, vetas cada ~70 m.
float big = triNoise(vWorld, n, 1.0 / 700.0).r;
#ifdef FAR
float fine = 0.5; // lejos las vetas no se distinguen: 3 lecturas menos
#else
float fine = triNoise(vWorld, n, 1.0 / 70.0).g;
#endif
#endif
#ifdef MAT_N
// Proyección biplanar: pesos por la normal REMA (potencia 4), sin el eje más débil; el segundo plano
// solo se lee donde aporta (≥ 15 %), así casi todos los píxeles leen un solo plano (costo similar a
// la proyección por eje dominante, sin sus costuras). Sin estiramiento en paredes.
gBw = pow(abs(n), vec3(4.0));
gBw = max(gBw - min(gBw.x, min(gBw.y, gBw.z)), 0.0);
gBw /= max(gBw.x + gBw.y + gBw.z, 1e-4);
// Continuous weights prevent texture projection seams on changing coast normals.
gBw /= max(gBw.x + gBw.y + gBw.z, 1e-4);
gUvX = vWorld.zy; gUvY = vWorld.xz; gUvZ = vWorld.xy;
gGXx = dFdx(gUvX); gGXy = dFdy(gUvX); gGYx = dFdx(gUvY); gGYy = dFdy(gUvY); gGZx = dFdx(gUvZ); gGZy = dFdy(gUvZ);
gK = texture2D(uNoise, vWorld.xz * (1.0 / 37.0)).g;
float dDet = uDetailOn * (1.0 - smoothstep(uDetailFade.x, uDetailFade.y, length(cameraPosition - vWorld))) * (1.0 - isSea);
// Borde nieve-roca: umbral de pendiente REMA (~47°), corrido por las cavidades del relieve (la nieve
// queda en hondonadas) y la variación de baja frecuencia; transición de ±0,02 de pendiente
// (uRockLook.w), nunca menos de ~1 píxel: definida, sin difuminar ni recortes duros.
#ifdef SNOW_VOL_FRAG
// Paredes: con la normal suavizada (~11 m) los bordes de acantilado y las cavidades de roca empinada se
// pintaban de nieve (manchas pegadas, bordes verticales blancos). La pendiente a 4 m los pasa a roca.
vec2 nF = surf.rg * 2.0 - 1.0;
float steepF = closureFace ? 1.0 : 1.0 - sqrt(max(0.0, 1.0 - dot(nF, nF)));
float cavW = 1.0 - uSnowDisp.w * smoothstep(0.30, 0.50, steepF);
float tEdge = steep + (big - 0.5) * 0.12 * uColorVar + (cav - 0.82) * 0.25 * cavW + uSnowDisp.w * uSnowCliff * smoothstep(0.38, 0.6, steepF);
#else
float tEdge = steep + (big - 0.5) * 0.12 * uColorVar + (cav - 0.82) * 0.25;
#endif
float wEdge = max(fwidth(tEdge) * 0.75, uRockLook.w);
float rockT = smoothstep(0.32 - wEdge, 0.32 + wEdge, tEdge);
#ifdef SNOW_VOL_FRAG
// Cobertura con borde ancho para la sombra de contacto.
float bankF = snowBank(tEdge);
#endif
#else
float rockT = smoothstep(0.30, 0.34, steep + ((big - 0.5) * 0.16 + (fine - 0.5) * 0.05) * uColorVar);
#endif
#ifdef MAT_N
// ── Roca: textura real (Poly Haven Marble Cliff 04, CC0) en KTX2, albedo + normal OpenGL ──
// Detalle a escala física (uTexScale.x) y la misma textura a media distancia (uRockMacro), ambas con
// muestreo aperiódico (sin repetición visible). Solo se lee donde hay roca.
float S_ROCK = 1.0 / uTexScale.x;
float S_SNOW = 1.0 / uTexScale.y;
vec3 rockAlb = vec3(0.3);
vec3 rockNw = n, snowNw = nSm;
if (rockT > 0.003 && uPaint < 0.999) {
  gGrad = uRockLook.z;
  rockAlb = biColor(uRockCol, S_ROCK);
#ifndef FAR
  if (dDet > 0.001) rockNw = biNormal(uRockNor, n, S_ROCK, uRockLook.x);
#endif
  if (uRockMacro.y > 0.0) {
    float SM = 1.0 / uRockMacro.x;
    vec3 macroAlb = biColor(uRockCol, SM);
    // la capa media modula el tono (fracturas grandes) sin cambiar el color medio
    rockAlb = mix(rockAlb, rockAlb * macroAlb / max(dot(macroAlb, vec3(0.333)), 0.03), uRockMacro.y);
#ifndef FAR
    if (dDet > 0.001 && uRockRelief.y > 0.0) rockNw = normalize(rockNw + (biNormal(uRockNor, n, SM, uRockLook.x) - n) * uRockMacro.y * uRockRelief.y);
#endif
  }
  gGrad = 1.0;
}
#ifndef FAR
// Fracturas de la roca: relieve de detalle generado en el navegador (el mismo de la prueba C: caras
// angulosas de 2–15 m, mosaico de 97 m, aperiódico), solo sobre la roca y solo de cerca. Proyección por
// eje dominante (2 lecturas). Interpretación artística: no son fracturas medidas.
if (uPaint < 0.999 && !closureFace && rockT > 0.003 && dDet > 0.001 && uRockFrac > 0.0) {
  vec3 an = abs(n);
  vec2 puv;
  int ax;
  if (an.y >= an.x && an.y >= an.z) { puv = vWorld.xz; ax = 1; }
  else if (an.x >= an.z) { puv = vWorld.zy; ax = 0; }
  else { puv = vWorld.xy; ax = 2; }
  vec2 d2 = aperiodicDetail(uDetail, puv * (1.0 / 97.0), fine).xy;
  vec3 pert = ax == 1 ? vec3(d2.x, 0.0, d2.y) : ax == 0 ? vec3(0.0, d2.y, d2.x) : vec3(d2.x, d2.y, 0.0);
  rockNw = normalize(rockNw + pert * uRockFrac * dDet);
}
// Nieve: microrelieve muy sutil (Snow007A), solo de cerca.
if (uPaint < 0.999 && rockT < 0.997 && dDet > 0.001 && uStylize.w > 0.0) snowNw = biNormal(uSnowNor, nSm, S_SNOW, uStylize.w);
#endif
// Roca: gris mineral desde la textura real. Se conserva su variación de luminancia (bloques,
// fracturas) con contraste regulable (uRockLook.y) y una fracción de su color (uRockTone.y; 0: el
// mármol de la foto es crema), normalizada a la luminancia media uRockTone.x y levemente fría.
const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);
float rockL = dot(rockAlb, LUMW), meanL = dot(uRockMean, LUMW);
float dL = (rockL - meanL) * uRockLook.y;
float rockL2 = max(meanL + (dL > 0.0 ? dL * uRockTone.z : dL), 0.0);
vec3 rock = mix(vec3(rockL2), rockAlb * (rockL2 / max(rockL, 1e-3)), uRockTone.y) * (uRockTone.x / max(meanL, 1e-3)) * vec3(0.96, 0.99, 1.06);
rock *= mix(1.0, 0.85 + 0.15 * cav, uColorVar);
#ifdef SNOW_VOL_FRAG
// la roca recién expuesta, bajo el borde de la nieve, en algo de sombra
rock *= mix(1.0 - uSnowBank.y * 1.4 * uSnowDisp.w, 1.0, smoothstep(0.32, 0.45, tEdge));
#endif
// Surcos y crestas del REMA (curvatura con signo a 8 y 24 m): surcos más oscuros, aristas más claras.
float crv = closureFace ? 0.0 : lgt.b * 2.0 - 1.0;
#ifdef SNOW_VOL_FRAG
crv *= 1.0 - wallK;
#endif
// Crestas apenas más claras (tope ×1,2): con más, las aristas quedaban como estelas blancas.
rock *= clamp(1.0 - crv * (crv > 0.0 ? uRockRelief.x : uRockRelief.z), 0.35, 1.2);
#else
vec3 rock = mix(uRockA, uRockB, mix(0.5, smoothstep(0.35, 0.75, fine * 0.6 + big * 0.4), uColorVar));
rock *= mix(1.0, 0.75 + 0.25 * cav, uColorVar);
#endif
#ifdef MAT_N
// Estilizado: el sombreado por cavidades (escalas de 24 y 64 m) moteaba la nieve; queda al 20 %.
vec3 snow = mix(uSnow, mix(uSnowShade, uSnow, smoothstep(0.55, 0.95, cav)), uColorVar * uSnowLook.y);
#ifdef SNOW_VOL_FRAG
// sombra de contacto: el pie del banco de nieve, junto a la roca
snow *= mix(1.0 - uSnowBank.y * uSnowDisp.w, 1.0, smoothstep(0.0, 0.6, bankF));
#endif
#if defined(SNOW_VOL) && NUM_DIR_LIGHTS > 0
// Forma de la nieve: según cuánto mira al sol (normal de la nieve, con relieve y bancos), de blanco a azul
// grisáceo frío. Hace legible el volumen que el relleno del cielo emparejaba. Solo operaciones, sin lecturas.
if (uSnowForm.a > 0.0 && uSnowDisp.w > 0.0) {
  float sunF = dot(normalize((viewMatrix * vec4(nSm, 0.0)).xyz), directionalLights[0].direction);
  snow *= mix(vec3(1.0), uSnowForm.rgb, uSnowForm.a * uSnowDisp.w * (1.0 - smoothstep(uSnowFormR.x, uSnowFormR.y, sunF)));
}
#endif
#else
vec3 snow = mix(uSnow, mix(uSnowShade, uSnow, smoothstep(0.55, 0.95, cav)), uColorVar);
#endif
#ifdef MAT_N
// Volumen de la nieve (relieve REMA): hondonadas y surcos levemente sombreados y fríos, lomas apenas
// más claras. Sin ruido: solo la curvatura con signo de los datos.
float crvS = lgt.b * 2.0 - 1.0;
// Tono de sombra apenas azulado (antes 0,80/0,87/0,97 a pleno: ensuciaba la nieve de gris) y solo en
// los surcos marcados (umbral 0,15): la nieve sigue blanca y limpia en el resto.
float crvK = smoothstep(0.15, 0.6, crvS * uSnowRelief);
snow *= mix(vec3(1.0), vec3(0.9, 0.94, 1.0), crvK);
#endif
#if defined(MAT_B) || defined(MAT_C) || defined(MAT_N)
// Variación de baja frecuencia: nieve venteada algo más fría/gris en zonas amplias; roca más o menos clara.
#ifdef SNOW_VOL
// Zonas de nieve venteada (más fría): dos lecturas del ruido giradas y a escalas distintas, y más suave.
// Con una sola lectura del ruido de valor (celdas de ~237 m alineadas a la grilla) se veían cuadrados
// azules en superficies planas (Belgrano II).
float bigS = 0.5 * (big + texture2D(uNoise, mat2(0.6, 0.8, -0.8, 0.6) * vWorld.xz * (1.0 / 1370.0) + 0.37).r);
snow *= mix(vec3(1.0), vec3(0.94, 0.965, 0.995), smoothstep(0.4, 0.75, bigS) * uColorVar);
#else
snow *= mix(vec3(1.0), vec3(0.9, 0.94, 0.99), smoothstep(0.45, 0.8, big) * uColorVar);
#endif
rock *= mix(1.0, mix(0.86, 1.12, big), uColorVar);
#endif
gPaintRock=rockT;
${PAINT_COLOR}
// Hielo (interpretación): paredes empinadas junto a la costa y cerca del nivel del mar.
float lowAlt = 1.0 - smoothstep(25.0, 60.0, vWorld.y - uSeaY);
float cliff = smoothstep(0.63, 0.91, shore) * smoothstep(0.22, 0.46, steep) * lowAlt;
// A closure is not evidence of an ice front: do not paint synthetic ice onto it.
float iceT = closureFace ? 0.0 : cliff * (1.0 - rockT * 0.66);
#ifdef SNOW_VOL_FRAG
// Paredes detectadas (frente de acantilado): roca, no hielo. Con la detección de paredes, esas caras pasaron a
// ser empinadas y la regla del hielo las pintaba celeste verdoso en toda la orilla.
iceT *= 1.0 - wallK;
#endif
#ifdef MAT_N
gSnowK = (1.0 - rockT) * (1.0 - isSea) * (1.0 - iceT);
#endif
iceT *= 1.0-uPaint*(1.0-uPaintArt);
gSnowK *= 1.0-uPaint;
gSun = mix(gSun, 1.0, 0.18 * cliff);
snow*=1.0-min(.22,trackDepth(vWorld.xz)*1.0)*(1.0-rockT);
vec3 land = mix(mix(snow, rock, rockT), mix(uIce * (0.8 + 0.2 * fine),paintIce,uPaint*uPaintArt), iceT);
float foam;
vec3 sea = seaColor(shore, fine, foam);
diffuseColor.rgb = mix(land, sea, isSea);
#ifdef SNOW_VOL_FRAG
#endif
// Fondo bajo el agua (reconstrucción artística junto a la costa): grava y roca oscuras que se absorben
// hacia el azul del mar con la profundidad; se ve a través del agua semitransparente de la orilla.
// La franja a la altura del agua (isSea) también va con el color del fondo de la orilla: con el color del
// mar profundo dibujaba un borde oscuro en toda la costa (el agua del océano ya la cubre).
float underW = max(1.0 - smoothstep(-0.8, 0.1, vWorld.y - uSeaY), isSea * uShoreBand);
if (underW > 0.0) {
  float depthW = max(uSeaY - vWorld.y, 0.0);
  // orilla clara (grava y arena húmedas vistas a través de poca agua) → turquesa → azul profundo
  vec3 bed = uSeaBed * mix(0.8, 1.0, cav);
  bed = mix(bed, uSeaBedMid, smoothstep(0.0, uSeaBedDepth.x, depthW));
  bed = mix(bed, uSeaDeep * 0.9, smoothstep(uSeaBedDepth.x, uSeaBedDepth.y, depthW));
  diffuseColor.rgb = mix(diffuseColor.rgb, bed, underW);
}
#ifdef MAT_N
gRough = mix(mix(mix(0.92, 0.95, rockT), 0.3, iceT), mix(uSeaLook.w, 0.7, foam), isSea); // nieve mate
#else
gRough = mix(mix(mix(0.82, 0.95, rockT), 0.28, iceT), mix(0.16, 0.7, foam), isSea);
#endif
gRough = mix(gRough,mix(paintRough,.68,iceT*uPaintArt),uPaint);
vec3 nd = n;
#ifdef MAT_N
// Luz: normal de la roca (textura, RNM sobre REMA) donde hay roca.
nd = normalize(mix(nSm, rockNw, rockT));
#endif
#ifndef FAR
// Detalle de cerca (triplanar, 3 lecturas): grietas en roca, ondas de viento en nieve.
// Se desvanece entre 500 y 2200 m; casi nulo en hielo; nada en el agua.
float dAmt = uDetailOn * uDetailGain * (1.0 - smoothstep(uDetailFade.x, uDetailFade.y, length(cameraPosition - vWorld))) * (1.0 - isSea);
if (dAmt > 0.001) {
#if defined(MAT_N)
  // Microrelieve de la nieve solo de cerca (las placas de roca ya están en nd, a toda distancia).
  nd = normalize(mix(nd, snowNw, (1.0 - rockT) * dAmt * (1.0 - iceT * 0.85)));
#elif defined(MAT_B) || defined(MAT_C)
  // B/C: una sola proyección, la del eje dominante de la normal (sin triplanar completo).
  vec3 an = abs(n);
  vec2 puv;
  int ax;
  if (an.y >= an.x && an.y >= an.z) { puv = vWorld.xz; ax = 1; }
  else if (an.x >= an.z) { puv = vWorld.zy; ax = 0; }
  else { puv = vWorld.xy; ax = 2; }
#ifdef MAT_N
  puv *= 1.0 / 60.0; // mosaico de 60 m: roca con formas de 8–15 m; nieve con grano de ~1–2 m
  vec4 dd = texture2D(uDetailN, puv) * 2.0 - 1.0; // 1 lectura
#else
  puv *= 1.0 / 97.0; // mosaico de 97 m: no es múltiplo de las otras escalas
#endif
#if defined(MAT_N)
#elif defined(MAT_C)
  vec4 dd = aperiodicDetail(uDetail, puv, fine); // 2 lecturas
#else
  vec4 dd = texture2D(uDetail, puv) * 2.0 - 1.0; // 1 lectura
#endif
  vec2 d2 = mix(dd.zw, dd.xy, rockT);
  vec3 pert = ax == 1 ? vec3(d2.x, 0.0, d2.y) : ax == 0 ? vec3(0.0, d2.y, d2.x) : vec3(d2.x, d2.y, 0.0);
#ifdef MAT_N
  float str = mix(0.06, 0.75, rockT) * (1.0 - iceT * 0.85) * dAmt; // nieve casi lisa; roca moderada
#else
  float str = mix(0.2, 1.7, rockT) * (1.0 - iceT * 0.85) * dAmt;
#endif
  nd = normalize(n + pert * str);
#else
  vec3 w3 = pow(abs(n), vec3(4.0)); w3 /= (w3.x + w3.y + w3.z);
  float f = 1.0 / 110.0; // un mosaico cada ~110 m: grietas y ondas de 2–15 m, legibles a cientos de metros
  vec4 tx = texture2D(uDetail, vWorld.zy * f);
  vec4 ty = texture2D(uDetail, vWorld.xz * f);
  vec4 tz = texture2D(uDetail, vWorld.xy * f);
  vec2 dx = mix(tx.ba, tx.rg, rockT) * 2.0 - 1.0;
  vec2 dy = mix(ty.ba, ty.rg, rockT) * 2.0 - 1.0;
  vec2 dz = mix(tz.ba, tz.rg, rockT) * 2.0 - 1.0;
  float str = mix(0.2, 1.7, rockT) * (1.0 - iceT * 0.85) * dAmt;
  vec3 pert = vec3(0.0, dx.y, dx.x) * w3.x + vec3(dy.x, 0.0, dy.y) * w3.y + vec3(dz.x, dz.y, 0.0) * w3.z;
  nd = normalize(n + pert * str);
#endif
}
#endif

#ifdef MAT_N
nd=normalize(mix(nd,normalize(mix(nSm,paintRockNormal,rockT)),uPaint));
#else
nd=normalize(mix(nd,paintRockNormal,uPaint));
#endif
vec3 seaN = isSea > 0.0 ? seaNormal(vWorld) : vec3(0.0, 1.0, 0.0);
${TRACK_NORMAL}
gN = mix(nd, seaN, isSea);
gRefl = isSea * (1.0 - foam) * seaReflection(seaN, vWorld);
#ifdef MAT_N
// Cristales de hielo de la nieve: celdas del tamaño de ~1,5 píxeles (potencia de 2 del tamaño en mundo,
// estable al acercarse), una fracción (uSnowGlint.w) son cristales con una cara orientada al azar
// alrededor de la normal; en la luz del sol solo brillan los que reflejan el sol hacia la cámara.
{
  // lado corto del píxel en el mundo: en ángulo rasante, con el lado largo los destellos salían como rayitas
  float pxW = min(length(dFdx(vWorld)), length(dFdy(vWorld)));
  float cellS = exp2(ceil(log2(max(pxW * 1.5, 0.02))));
  vec3 cid = floor(vWorld / cellS);
  vec3 hr = fract(sin(vec3(dot(cid, vec3(127.1, 311.7, 74.7)), dot(cid, vec3(269.5, 183.3, 246.1)), dot(cid, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
  vec3 facet = normalize(gN + (hr.yzx * 2.0 - 1.0) * 0.45);
  gGlitN = normalize((viewMatrix * vec4(facet, 0.0)).xyz);
  gGlit = gSnowK * step(hr.x, uSnowGlint.w);
}
#endif
`;

const EDGE_HAZE = `
#ifdef USE_FOG
float edgeD = min(uHalf.x - abs(vWorld.x), uHalf.y - abs(vWorld.z));
if(uEdgeHaze > 0.0) gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, max(isSea, smoothstep(0.0, uEdgeHaze, edgeD))); // solo tierra
#endif`;

/** Sombra precalculada del sol: solo afecta a la luz directa; la luz ambiente sigue. */
const SUN_SHADOW_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gSun;\n\t\tfloat ndlS = dot( geometryNormal, directLight.direction );\n\t\tif ( ndlS > 0.0 ) directLight.color *= mix( 1.0, stylRamp( ndlS ) / max( ndlS, 0.04 ), max(uStylize.x,uPaint*mix(.15,.55,gPaintRock)) );" +
    // Reflejo del sol en la nieve: satinado especular amplio + dispersión hacia adelante (mirando al sol,
    // ángulo rasante) + destellos de cristales (cara del cristal alineada con el reflejo del sol).
    "\n\t\tif ( gSnowK > 0.0 && ndlS > 0.0 ) {" +
    "\n\t\t\tfloat aS = max( dot( geometryViewDir, reflect( -directLight.direction, geometryNormal ) ), 0.0 );" +
    "\n\t\t\tfloat fwd = pow( max( dot( -geometryViewDir, directLight.direction ), 0.0 ), 4.0 ) * pow( 1.0 - max( dot( geometryNormal, geometryViewDir ), 0.0 ), 2.0 );" +
    "\n\t\t\tfloat cr = pow( max( dot( geometryViewDir, reflect( -directLight.direction, gGlitN ) ), 0.0 ), 1500.0 );" +
    "\n\t\t\treflectedLight.directSpecular += directLight.color * ndlS * ( gSnowK * ( uSnowGlint.x * pow( aS, uSnowGlint.y ) + uSnowFwd * fwd ) + gGlit * uSnowGlint.z * cr );" +
    "\n\t\t}"
);

export interface StyleVariant extends VertexPath {
  /** Bloques lejanos: material más simple (sin vetas finas). */
  far?: boolean;
  /** El agua la dibuja el plano del mar: el terreno descarta sus píxeles de mar. */

  /** Prueba de materiales: a = actual, b = básico optimizado, c = b + muestreo aperiódico. */
  variant?: MaterialVariant;
}
export type MaterialVariant = "a" | "b" | "c" | "n";

export function stylizedMaterial(u: StyleUniforms, v: StyleVariant = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const defines: Record<string, string> = {};
  if (v.far) defines.FAR = "";

  if (v.exactCoast) defines.EXACT_COAST = "";
  if (v.variant === "b") defines.MAT_B = "";
  if (v.variant === "c") defines.MAT_C = "";
  if (v.variant === "n") {
    defines.MAT_N = "";
    defines.SNOW_VOL = ""; // desplazamiento en todos los niveles (mismos vértices compartidos: sin grietas)
    // Luz del relieve y paredes de acantilado solo en los bloques cercanos: lejos no se distinguen y así
    // las vistas generales no pagan el costo (medido: +0,7 ms en todos los niveles).
    if (!v.far) defines.SNOW_VOL_FRAG = "";
  }
  (m as unknown as { defines: Record<string, string> }).defines = defines;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    vertexPath(s, v, "\nvarying vec3 vWorld;\nuniform vec2 uHalf;\nuniform float uSeaY, uEdgeFade;" + SNOW_VOL_VERTEX_PARS + SNOW_VOL_COMMON + TRACK_PARS);
    // Después de definir `transformed` (cualquier camino): cierre del borde y posición de mundo.
    s.vertexShader = s.vertexShader.replace(
      "#include <morphtarget_vertex>",
      [
        "#include <morphtarget_vertex>",
        SNOW_VOL_VERTEX,
        COAST_RAMP_VERTEX,
        TRACK_VERTEX,
        "vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      ].join("\n")
    );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vSurfUv;${STYLE_FRAG_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${STYLE_COLOR}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);")
      .replace("#include <fog_fragment>", `#include <fog_fragment>${EDGE_HAZE}`)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += gRefl;")
      .replace("#include <lights_fragment_begin>", SUN_SHADOW_LIGHTS);
  };
  return m;
}

/**
 * Plano del mar (fase 2): dibuja toda el agua, dentro y fuera del recorte, con el mismo
 * color de costa y sombra del sol que el terreno (mapea la posición de mundo a las texturas).
 */
export function seaPlaneMaterial(u: StyleUniforms, grid: Pick<GridUniforms, "uGridSize" | "uTexSize" | "uCell" | "uStride">) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.16, metalness: 0 });
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, grid);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>${STYLE_FRAG_PARS}\nuniform vec2 uGridSize, uTexSize;\nuniform float uCell, uStride;`)
      .replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "vec2 cr = (vWorld.xz + (uGridSize - 1.0) * uCell * 0.5) / uCell;",
          "vec2 uv = (cr * uStride + 0.5) / uTexSize;",
          "float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);",
          "vec4 lgt = inside > 0.5 ? texture2D(uLight, uv) : vec4(1.0, 0.0, 0.0, 1.0);",
          "gSun = lgt.r;",
          "float fine = texture2D(uNoise, vWorld.xz / 70.0).g;",
          "float foam;",
          "diffuseColor.rgb = seaColor(lgt.g, fine, foam);",
          "gRough = mix(uSeaLook.w, 0.7, foam);",
          "gN = seaNormal(vWorld);",
          "gRefl = (1.0 - foam) * seaReflection(gN, vWorld);",
        ].join("\n")
      )
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += gRefl;")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace("#include <lights_fragment_begin>", SUN_SHADOW_LIGHTS);
  };
  return m;
}
