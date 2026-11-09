import * as THREE from "three";
import { lin, noiseTexture, type SharedTextures } from "./materials";

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
attribute vec2 chunk;`;

const GRID_BEGIN_VERTEX = `
vec2 cr = min(chunk + position.xy, uGridSize - 1.0);
float hgt = texelFetch(uHeight, ivec2(cr), 0).r * uK - position.z * uSkirt;
vec3 transformed = vec3(cr.x * uCell - (uGridSize.x - 1.0) * uCell * 0.5, hgt, cr.y * uCell - (uGridSize.y - 1.0) * uCell * 0.5);
vSurfUv = (cr * uStride + 0.5) / uTexSize;`;

export interface VertexPath {
  grid?: GridUniforms;
  /** Profundidad del faldón (m): tapa las uniones entre bloques de distinto nivel. */
  skirt?: { value: number };
}

function vertexPath(s: THREE.WebGLProgramParametersWithUniforms, v: VertexPath, extraPars = "") {
  if (v.grid) {
    Object.assign(s.uniforms, v.grid, { uSkirt: v.skirt ?? { value: 0 } });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vSurfUv;${GRID_VERTEX_PARS}${extraPars}`)
      .replace("#include <begin_vertex>", GRID_BEGIN_VERTEX);
  } else {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\nattribute vec2 surfUv;\nvarying vec2 vSurfUv;${extraPars}`)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfUv = surfUv;");
  }
}

// ─── BASE ───────────────────────────────────────────────────
export function baseMaterial(tex: SharedTextures, v: VertexPath = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
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
          "if (surf.a < 0.25) discard;",
          "vec3 nDet = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);",
          "nDet.y = sqrt(max(0.0, 1.0 - dot(nDet.xz, nDet.xz)));",
          "vec3 ground = mix(uSnow, uRock, smoothstep(0.18, 0.42, 1.0 - nDet.y));",
          "float isSea = 1.0 - smoothstep(0.55, 0.85, surf.a);",
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
    uSurface: { value: tex.surface },
    uLight: { value: tex.light },
    uNoise: { value: noiseTexture() },
    uHalf: { value: new THREE.Vector2(...p.halfSize) },
    uSeaY: { value: p.seaY },
    // Solo la última franja de ~60 m baja al mar (cierra el borde); el resto del borde
    // se disuelve en la niebla por color, sin tocar el relieve.
    uEdgeFade: { value: 60 },
    uEdgeHaze: { value: 350 },
    uSnow: { value: lin("#f3f6f8") },
    uSnowShade: { value: lin("#c9d9e6") },
    uRockA: { value: lin("#5d554e") },
    uRockB: { value: lin("#8a8178") },
    uIce: { value: lin("#9fd3e6") },
    uSeaDeep: { value: lin("#14303f") },
    uSeaShallow: { value: lin("#2b5a6b") },
    uFoam: { value: lin("#dfeef3") },
  };
}
export type StyleUniforms = ReturnType<typeof styleUniforms>;

const STYLE_FRAG_PARS = `
uniform sampler2D uSurface, uLight, uNoise;
uniform vec3 uSnow, uSnowShade, uRockA, uRockB, uIce, uSeaDeep, uSeaShallow, uFoam;
uniform float uSeaY, uEdgeHaze;
uniform vec2 uHalf;
varying vec3 vWorld;
float gSun = 1.0;
float gRough = 0.8;
vec3 gN = vec3(0.0, 1.0, 0.0);
vec2 triNoise(vec3 p, vec3 n, float f) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uNoise, p.zy * f).rg * w.x + texture2D(uNoise, p.xz * f).rg * w.y + texture2D(uNoise, p.xy * f).rg * w.z;
}
vec3 seaColor(float shore, float fine, out float foam) {
  foam = smoothstep(0.86, 0.97, shore) * (0.55 + 0.45 * fine);
  vec3 sea = mix(uSeaDeep, uSeaShallow, smoothstep(0.2, 0.85, shore));
  return mix(sea, uFoam, foam * 0.85);
}`;

const STYLE_COLOR = `
vec4 surf = texture2D(uSurface, vSurfUv);
if (surf.a < 0.25) discard;
float isSea = 1.0 - smoothstep(0.55, 0.85, surf.a);
vec4 lgt = texture2D(uLight, vSurfUv);
#ifdef SEA_BY_PLANE
// Mar abierto (> ~90 m de la costa): lo dibuja el plano. El agua costera la sigue
// dibujando el terreno, igual que en la fase 1 (el plano la filtra peor en ángulos rasantes).
if (isSea > 0.5 && lgt.g < 0.45) discard;
#endif
vec3 n = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);
n.y = sqrt(max(0.0, 1.0 - dot(n.xz, n.xz)));
float steep = 1.0 - n.y;
float cav = surf.b;
float shore = lgt.g;
gSun = lgt.r;
// Variación procedural (triplanar): manchas cada ~700 m, vetas cada ~70 m.
float big = triNoise(vWorld, n, 1.0 / 700.0).r;
#ifdef FAR
float fine = 0.5; // lejos las vetas no se distinguen: 3 lecturas menos
#else
float fine = triNoise(vWorld, n, 1.0 / 70.0).g;
#endif
float rockT = smoothstep(0.30, 0.34, steep + (big - 0.5) * 0.16 + (fine - 0.5) * 0.05);
vec3 rock = mix(uRockA, uRockB, smoothstep(0.35, 0.75, fine * 0.6 + big * 0.4));
rock *= 0.75 + 0.25 * cav;
vec3 snow = mix(uSnowShade, uSnow, smoothstep(0.55, 0.95, cav));
// Hielo (interpretación): paredes empinadas junto a la costa y cerca del nivel del mar.
float lowAlt = 1.0 - smoothstep(25.0, 60.0, vWorld.y - uSeaY);
float iceT = smoothstep(0.72, 0.9, shore) * smoothstep(0.22, 0.34, steep) * lowAlt * (1.0 - rockT * 0.7);
vec3 land = mix(mix(snow, rock, rockT), uIce * (0.8 + 0.2 * fine), iceT);
float foam;
vec3 sea = seaColor(shore, fine, foam);
diffuseColor.rgb = mix(land, sea, isSea);
gRough = mix(mix(mix(0.82, 0.95, rockT), 0.28, iceT), mix(0.16, 0.7, foam), isSea);
gN = mix(n, vec3(0.0, 1.0, 0.0), isSea);`;

const EDGE_HAZE = `
#ifdef USE_FOG
float edgeD = min(uHalf.x - abs(vWorld.x), uHalf.y - abs(vWorld.z));
gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, max(isSea, smoothstep(0.0, uEdgeHaze, edgeD))); // solo tierra
#endif`;

/** Sombra precalculada del sol: solo afecta a la luz directa; la luz ambiente sigue. */
const SUN_SHADOW_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gSun;"
);

export interface StyleVariant extends VertexPath {
  /** Bloques lejanos: material más simple (sin vetas finas). */
  far?: boolean;
  /** El agua la dibuja el plano del mar: el terreno descarta sus píxeles de mar. */
  seaByPlane?: boolean;
}

export function stylizedMaterial(u: StyleUniforms, v: StyleVariant = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const defines: Record<string, string> = {};
  if (v.far) defines.FAR = "";
  if (v.seaByPlane) defines.SEA_BY_PLANE = "";
  (m as unknown as { defines: Record<string, string> }).defines = defines;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    vertexPath(s, v, "\nvarying vec3 vWorld;\nuniform vec2 uHalf;\nuniform float uSeaY, uEdgeFade;");
    // Después de definir `transformed` (cualquier camino): cierre del borde y posición de mundo.
    s.vertexShader = s.vertexShader.replace(
      "#include <morphtarget_vertex>",
      [
        "#include <morphtarget_vertex>",
        "float edge = min(uHalf.x - abs(transformed.x), uHalf.y - abs(transformed.z));",
        "transformed.y = mix(uSeaY, transformed.y, smoothstep(0.0, uEdgeFade, edge));",
        "vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      ].join("\n")
    );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vSurfUv;${STYLE_FRAG_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>${STYLE_COLOR}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);")
      .replace("#include <fog_fragment>", `#include <fog_fragment>${EDGE_HAZE}`)
      .replace("#include <lights_fragment_begin>", SUN_SHADOW_LIGHTS);
  };
  return m;
}

/**
 * Plano del mar (fase 2): dibuja toda el agua, dentro y fuera del recorte, con el mismo
 * color de costa y sombra del sol que el terreno (mapea la posición de mundo a las texturas).
 */
export function seaPlaneMaterial(u: StyleUniforms, grid: GridUniforms) {
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
          "gRough = mix(0.16, 0.7, foam);",
        ].join("\n")
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace("#include <lights_fragment_begin>", SUN_SHADOW_LIGHTS);
  };
  return m;
}
