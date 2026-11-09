import * as THREE from "three";

/**
 * Dos materiales sobre la misma geometría y las mismas texturas calculadas:
 *  - BASE: el sombreado de exploraciones/terreno-nitidez (modo "Después"), para medir el antes.
 *  - ESTILIZADO: interpretación artística (fase 1). Todo deriva del relieve REMA, la costa ADD
 *    y una sombra de sol fijo; el ruido procedural solo agrega variación visual.
 */

const lin = (hex: string) => {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
};

export interface SharedTextures {
  surface: THREE.DataTexture;
  light: THREE.DataTexture;
}

/**
 * Textura de ruido tileable (256², RG8) generada al cargar: 0 bytes de descarga.
 * R = ruido de valor suave, G = fbm de 3 octavas. Reemplaza el ruido procedural
 * calculado por píxel, que triplicaba el tiempo de GPU (medido: 6,3 → 20,7 ms).
 */
let noiseTex: THREE.DataTexture | null = null;
export function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N * 2);
  const lattice = (n: number, seed: number) => {
    const g = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return g;
  };
  // Ruido de valor periódico con interpolación suave; `cells` celdas por lado.
  const value = (cells: number, seed: number) => {
    const g = lattice(cells, seed);
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells, fy = (y / N) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[((b % cells) * cells) + (a % cells)];
      out[y * N + x] = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    }
    return out;
  };
  const v8 = value(8, 7);
  const v16 = value(16, 13), v32 = value(32, 29), v64 = value(64, 41);
  for (let i = 0; i < N * N; i++) {
    data[i * 2] = Math.round(v8[i] * 255);
    data[i * 2 + 1] = Math.round((0.55 * v16[i] + 0.3 * v32[i] + 0.15 * v64[i]) * 255);
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.UnsignedByteType);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.generateMipmaps = true;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.colorSpace = THREE.NoColorSpace;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

export function baseMaterial(tex: SharedTextures) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const uniforms = {
    uSurface: { value: tex.surface },
    uSnow: { value: lin("#eef3f6") },
    uRock: { value: lin("#4a4643") },
    uSea: { value: lin("#1d3a4c") },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 surfUv;\nvarying vec2 vSurfUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurfUv = surfUv;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform sampler2D uSurface;\nuniform vec3 uSnow, uRock, uSea;\nvarying vec2 vSurfUv;"
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec4 surf = texture2D(uSurface, vSurfUv);
if (surf.a < 0.25) discard;
vec3 nDet = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);
nDet.y = sqrt(max(0.0, 1.0 - dot(nDet.xz, nDet.xz)));
vec3 ground = mix(uSnow, uRock, smoothstep(0.18, 0.42, 1.0 - nDet.y));
float isSea = 1.0 - smoothstep(0.55, 0.85, surf.a);
diffuseColor.rgb = mix(ground, uSea, isSea) * mix(1.0, surf.b, 1.0 - isSea);`
      )
      .replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(nDet, 0.0)).xyz);"
      );
  };
  return m;
}

export interface StyleParams {
  /** Mitad del ancho/profundidad del recorte (m) para disolver los bordes. */
  halfSize: [number, number];
  /** Altura relativa del mar (m, ya exagerada). */
  seaY: number;
}

export function stylizedMaterial(tex: SharedTextures, p: StyleParams) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const uniforms = {
    uSurface: { value: tex.surface },
    uLight: { value: tex.light },
    uNoise: { value: noiseTexture() },
    uHalf: { value: new THREE.Vector2(...p.halfSize) },
    uSeaY: { value: p.seaY },
    // Solo la última franja de ~60 m baja al mar (cierra el borde); el resto del borde
    // se disuelve en la niebla por color, sin tocar el relieve.
    uEdgeFade: { value: 60 },
    uEdgeHaze: { value: 350 },
    // Paleta (lineal). Pensada para leer bien con tonemapping Neutral.
    uSnow: { value: lin("#f3f6f8") },
    uSnowShade: { value: lin("#c9d9e6") },
    uRockA: { value: lin("#5d554e") },
    uRockB: { value: lin("#8a8178") },
    uIce: { value: lin("#9fd3e6") },
    uSeaDeep: { value: lin("#14303f") },
    uSeaShallow: { value: lin("#2b5a6b") },
    uFoam: { value: lin("#dfeef3") },
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec2 surfUv;
varying vec2 vSurfUv;
varying vec3 vWorld;
uniform vec2 uHalf;
uniform float uSeaY, uEdgeFade;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSurfUv = surfUv;
// Borde del recorte: solo la última franja (~60 m) baja al nivel del mar para cerrar
// la malla (interpretación mínima; no cambia perfiles de montañas).
float edge = min(uHalf.x - abs(transformed.x), uHalf.y - abs(transformed.z));
transformed.y = mix(uSeaY, transformed.y, smoothstep(0.0, uEdgeFade, edge));
vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uSurface, uLight, uNoise;
uniform vec3 uSnow, uSnowShade, uRockA, uRockB, uIce, uSeaDeep, uSeaShallow, uFoam;
uniform float uSeaY, uEdgeHaze;
uniform vec2 uHalf;
#define uSeaYf uSeaY
varying vec2 vSurfUv;
varying vec3 vWorld;
float gSun = 1.0;
float gRough = 0.8;
vec3 gN = vec3(0.0, 1.0, 0.0);

// Triplanar sobre la textura de ruido: proyecta en los tres ejes y mezcla según la
// normal → no se estira en paredes. 3 lecturas de textura por llamada.
vec2 triNoise(vec3 p, vec3 n, float f) {
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(uNoise, p.zy * f).rg * w.x + texture2D(uNoise, p.xz * f).rg * w.y + texture2D(uNoise, p.xy * f).rg * w.z;
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
vec4 surf = texture2D(uSurface, vSurfUv);
vec4 lgt = texture2D(uLight, vSurfUv);
if (surf.a < 0.25) discard;
float isSea = 1.0 - smoothstep(0.55, 0.85, surf.a);
vec3 n = vec3(surf.r * 2.0 - 1.0, 0.0, surf.g * 2.0 - 1.0);
n.y = sqrt(max(0.0, 1.0 - dot(n.xz, n.xz)));
float steep = 1.0 - n.y;
float cav = surf.b;
float shore = lgt.g;
gSun = lgt.r;

// Variación procedural (triplanar, en metros del mundo): grande para manchas, fina para vetas.
// La textura de ruido cubre 256 texeles: escala 1/700 → una repetición cada 700 m (manchas),
// 1/70 → cada 70 m (vetas finas, canal fbm).
float big = triNoise(vWorld, n, 1.0 / 700.0).r;
float fine = triNoise(vWorld, n, 1.0 / 70.0).g;

// Roca: transición nítida con borde irregular (rompe las "manchas" redondeadas).
float rockT = smoothstep(0.30, 0.34, steep + (big - 0.5) * 0.16 + (fine - 0.5) * 0.05);
vec3 rock = mix(uRockA, uRockB, smoothstep(0.35, 0.75, fine * 0.6 + big * 0.4));
rock *= 0.75 + 0.25 * cav;

// Nieve: blanca al sol, azulada en cavidades.
vec3 snow = mix(uSnowShade, uSnow, smoothstep(0.55, 0.95, cav));

// Hielo (interpretación): paredes empinadas junto a la costa = frentes de glaciar / acantilados de hielo.
float lowAlt = 1.0 - smoothstep(25.0, 60.0, vWorld.y - uSeaYf); // solo cerca del nivel del mar
float iceT = smoothstep(0.72, 0.9, shore) * smoothstep(0.22, 0.34, steep) * lowAlt * (1.0 - rockT * 0.7);
vec3 land = mix(mix(snow, rock, rockT), uIce * (0.8 + 0.2 * fine), iceT);

// Mar: más claro cerca de la costa, espuma fina en la orilla.
float foam = smoothstep(0.86, 0.97, shore) * (0.55 + 0.45 * fine);
vec3 sea = mix(uSeaDeep, uSeaShallow, smoothstep(0.2, 0.85, shore));
sea = mix(sea, uFoam, foam * 0.85);

diffuseColor.rgb = mix(land, sea, isSea);
gRough = mix(mix(mix(0.82, 0.95, rockT), 0.28, iceT), mix(0.16, 0.7, foam), isSea);
gN = mix(n, vec3(0.0, 1.0, 0.0), isSea);`
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = gRough;")
      .replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);"
      )
      // Bordes del recorte: se funden con la niebla (color), sin alterar la geometría.
      .replace(
        "#include <fog_fragment>",
        `#include <fog_fragment>
#ifdef USE_FOG
float edgeD = min(uHalf.x - abs(vWorld.x), uHalf.y - abs(vWorld.z));
gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, max(isSea, smoothstep(0.0, uEdgeHaze, edgeD))); // solo tierra
#endif`
      )
      // La sombra precalculada del sol solo afecta a la luz direccional; la luz ambiente sigue.
      .replace(
        "#include <lights_fragment_begin>",
        THREE.ShaderChunk.lights_fragment_begin.replace(
          "getDirectionalLightInfo( directionalLight, directLight );",
          "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= gSun;"
        )
      );
  };
  return { material: m, uniforms };
}
