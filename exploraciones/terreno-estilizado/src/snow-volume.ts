import * as THREE from "three";

/**
 * Volumen de la nieve (reconstrucción artística, no medición):
 *  - relieve de acumulaciones de 256² generado al cargar (0 bytes de descarga), compartido por todos
 *    los bloques y materiales;
 *  - el vertex shader desplaza la superficie hacia arriba o abajo (dunas suaves de ±1–2 m) solo donde
 *    hay nieve en pendientes suaves, lejos de la costa y cerca de la cámara; los datos REMA no cambian
 *    (ni la textura de alturas, ni heightsM, ni la colisión de la cámara);
 *  - el fragment shader usa el gradiente del mismo relieve como normal, así la luz coincide con la forma,
 *    más una segunda escala más fina (ondulaciones de viento) solo en la normal.
 * Se apaga con uSnowDisp.w = 0 (o ?nieve=plana) para comparar.
 */

const N = 256;
let tex: THREE.DataTexture | null = null;
let maxDeriv = 1;

/** R = altura (0–1), G,B = derivada (x, y) por mosaico normalizada a ±maxDeriv. Tileable. */
export function snowReliefTexture() {
  if (tex) return { tex, maxDeriv };
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Ruido de valor periódico con celdas distintas por eje (cx × cy): alargado = acumulación de viento.
  const value = (cx: number, cy: number, seed: number) => {
    const r = rng(seed), g = new Float32Array(cx * cy).map(() => r());
    return (u: number, v: number) => {
      const fx = (((u % 1) + 1) % 1) * cx, fy = (((v % 1) + 1) % 1) * cy;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      // quíntica (C2): con la cúbica el gradiente se quebraba en cada celda y la luz dibujaba cuadrados
      tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10); ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const at = (a: number, b: number) => g[(b % cy) * cx + (a % cx)];
      return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    };
  };
  // Acumulaciones suaves y redondeadas, apenas alargadas. Sin crestas finas (sastrugi) ni ondulaciones:
  // con ellas la nieve se veía rayada.
  const drift = value(4, 5, 11), drift2 = value(6, 7, 23);
  const warpA = value(4, 4, 53), warpB = value(4, 4, 71); // deforma las formas (sigue siendo periódico)
  const h = new Float32Array(N * N);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let u = x / N, v = y / N;
    u += (warpA(u, v) - 0.5) * 0.12; v += (warpB(u, v) - 0.5) * 0.12;
    const val = 0.7 * drift(u, v) + 0.3 * drift2(u + 0.37, v + 0.11);
    h[y * N + x] = val; lo = Math.min(lo, val); hi = Math.max(hi, val);
  }
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / (hi - lo);
  const dx = new Float32Array(N * N), dy = new Float32Array(N * N);
  maxDeriv = 1e-6;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    dx[i] = (h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)]) * (N / 2); // d h / d u (por mosaico)
    dy[i] = (h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]) * (N / 2);
    maxDeriv = Math.max(maxDeriv, Math.abs(dx[i]), Math.abs(dy[i]));
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = Math.round(h[i] * 255);
    data[i * 4 + 1] = Math.round((dx[i] / maxDeriv * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((dy[i] / maxDeriv * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return { tex, maxDeriv };
}

export function snowVolumeUniforms() {
  const r = snowReliefTexture();
  return {
    uSnowVol: { value: r.tex },
    // x = amplitud del desplazamiento (m) · y = mosaico de las acumulaciones (m) · z = mosaico de las
    // lomas chicas, solo normal (m) · w = 1 encendido / 0 apagado (para comparar).
    uSnowDisp: { value: new THREE.Vector4(3.5, 220, 70, new URLSearchParams(location.search).get("nieve") === "plana" ? 0 : 1) },
    // x = derivada máxima codificada · y = amplitud de las ondulaciones finas (m) · z = distancia (m) a la que
    // el desplazamiento llega a 0 (empieza a bajar al 60 %): lejos no se ve y los bloques gruesos no lo necesitan.
    uSnowVolK: { value: new THREE.Vector3(r.maxDeriv, 0, 1800) }, // lomas de ~15 m apagadas: manchaban la nieve (se veía rugosa)
    // Paredes: cuánto empuja a roca la pendiente fina (4 m) — sin manchas blancas pegadas en roca empinada.
    uSnowCliff: { value: 0.35 },
    // Borde de la nieve junto a la roca: y = sombra de contacto (x sin uso). Se probó que la nieve sobresalga
    // de la roca con la malla actual (vértices cada 8 m): bordes dentados, halos o astillas en rocas chicas.
    uSnowBank: { value: new THREE.Vector2(0, 0.18) },
    // Sombreado de forma de la nieve (dirección artística): las caras de la nieve que no miran al sol pasan
    // a un azul grisáceo frío. Con el relleno del cielo la nieve quedaba pareja y no se leía su volumen.
    // rgb = color de las caras en contra del sol (lineal) · a = intensidad (0 = apagado).
    uSnowForm: { value: new THREE.Vector4(0.48, 0.58, 0.74, 0.8) },
    // rango del sombreado: coseno con el sol desde el que empieza (x) y en el que termina (y) el tinte frío
    uSnowFormR: { value: new THREE.Vector2(0.35, 1.0) },
    // Orillas sin dientes de sierra (orillas bajas): x = pendiente de la rampa (m de altura por m de distancia
    // a la costa) · y = altura sobre el agua (m) hasta la que se aplica · z = ancho de la franja (m) · w = 1/0.
    uCoastRamp: { value: new THREE.Vector4(0.3, 5.0, 10.0, 1) }, // con -0,25…0,85 solo se teñían las caras muy en contra: no se notaba
  };
}

/** Declaraciones para el vertex shader (las del fragment van en STYLE_FRAG_PARS). */
export const SNOW_VOL_VERTEX_PARS = `
#ifdef SNOW_VOL
uniform sampler2D uSnowVol, uSurface, uNoise;
uniform vec4 uSnowDisp;
uniform vec3 uSnowVolK;
uniform vec2 uSnowBank;
uniform vec4 uCoastRamp;
#endif`;

/** Función común (vertex y fragment): altura relativa (−0,5…0,5) de las acumulaciones. */
export const SNOW_VOL_COMMON = `
#ifdef SNOW_VOL
const mat2 SNOW_R1 = mat2(0.8, 0.6, -0.6, 0.8);
const mat2 SNOW_R2 = mat2(0.28, -0.96, 0.96, 0.28);
// Zonas con y sin acumulaciones (si no, el mismo oleaje cubre toda la meseta y se lee como patrón). Dos
// lecturas del ruido de 1900 m, giradas y a escalas distintas: con una sola se veían cuadrados.
float snowVolZone(vec2 p) {
  float z = 0.5 * (textureLod(uNoise, p * (1.0 / 1900.0), 0.0).r + textureLod(uNoise, mat2(0.6, 0.8, -0.8, 0.6) * p * (1.0 / 1370.0) + 0.37, 0.0).r);
  return mix(0.1, 1.4, smoothstep(0.3, 0.7, z));
}
// Sin mosaico: el relieve se lee con muestreo estocástico (técnica 3 de I. Quílez, como el agua): un ruido
// suave elige uno de 8 desplazamientos por zona y se funden dos lecturas. Con una sola lectura, el mismo
// dibujo de acumulaciones se repetía cada 220 m (muy visible en mesetas planas como Belgrano II).
float snowHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float snowVN(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(snowHash(i), snowHash(i + vec2(1.0, 0.0)), f.x), mix(snowHash(i + vec2(0.0, 1.0)), snowHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 snowReliefLod(vec2 u, float lod) {
  float l = snowVN(u * 0.7) * 8.0, ia = floor(l), f = fract(l);
  vec4 a = textureLod(uSnowVol, u + sin(vec2(3.0, 7.0) * ia), lod);
  vec4 b = textureLod(uSnowVol, u + sin(vec2(3.0, 7.0) * (ia + 1.0)), lod);
  return mix(a, b, smoothstep(0.2, 0.8, f));
}
// Filtrado bicúbico B-spline con 4 lecturas bilineales (Sigg y Hadwiger, GPU Gems 2, cap. 20): sin los
// quiebres del bilineal en el borde de cada texel, que de cerca la luz marcaba como cuadrados.
vec4 texBSpline(sampler2D t, vec2 uv, int lod) {
  vec2 size = vec2(textureSize(t, lod));
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / size, h1 = (i + 1.0 + w3 / g1 + 0.5) / size;
  return g0.y * (g0.x * textureLod(t, h0, float(lod)) + g1.x * textureLod(t, vec2(h1.x, h0.y), float(lod)))
       + g1.y * (g0.x * textureLod(t, vec2(h0.x, h1.y), float(lod)) + g1.x * textureLod(t, h1, float(lod)));
}
// Cobertura de nieve con borde ancho (1 = nieve con todo su espesor, 0 = roca), a partir del mismo
// umbral de pendiente que separa nieve y roca en el material (0,32): el banco queda del lado de la nieve.
float snowBank(float tEdge) { return 1.0 - smoothstep(0.20, 0.33, tEdge); }
#endif`;

/**
 * Desplazamiento en el vertex shader. Misma función de la posición de mundo en los bloques LOD y en la
 * malla costera: los vértices compartidos se mueven igual (sin grietas). SNOW_K = exageración vertical.
 */
export const SNOW_VOL_VERTEX = `
#ifdef SNOW_VOL
if (uSnowDisp.w > 0.0) {
  vec3 wpS = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec4 sS = textureLod(uSurface, vSurfUv, 2.0); // normal REMA suavizada (~16 m) y distancia a la costa
  vec2 nS = sS.rg * 2.0 - 1.0;
  float steepS = 1.0 - sqrt(max(0.0, 1.0 - dot(nS, nS)));
  float placeS = smoothstep(4.0, 12.0, (sS.a * 255.0 - 128.0) / 8.0)  // ni en la línea de costa
              * smoothstep(1.0, 6.0, wpS.y - uSeaY)                   // ni junto al nivel del mar
              * (1.0 - smoothstep(uSnowVolK.z * 0.6, uSnowVolK.z, distance(cameraPosition, wpS)));
  float maskS = (1.0 - smoothstep(0.16, 0.30, steepS)) * placeS;    // pendiente: hasta ~40°, nada en acantilados
  float dyS = 0.0;
  if (maskS > 0.0) {
    float hS = snowReliefLod(SNOW_R1 * wpS.xz / uSnowDisp.y, 3.0).r - 0.5;
    dyS += uSnowDisp.x * hS * snowVolZone(wpS.xz) * maskS;
  }
  transformed.y += dyS * uSnowDisp.w * SNOW_K;
}
#endif`;

/** Gradiente (m/m) del relieve de nieve para la normal: acumulaciones + ondulaciones finas. */
export const SNOW_VOL_FRAG_FN = `
#ifdef SNOW_VOL
vec4 snowReliefGrad(vec2 u, vec2 gx, vec2 gy) {
  float l = snowVN(u * 0.7) * 8.0, ia = floor(l), f = fract(l);
  vec4 a = textureGrad(uSnowVol, u + sin(vec2(3.0, 7.0) * ia), gx, gy);
  vec4 b = textureGrad(uSnowVol, u + sin(vec2(3.0, 7.0) * (ia + 1.0)), gx, gy);
  return mix(a, b, smoothstep(0.2, 0.8, f));
}
// dpx, dpy = derivadas de pantalla de la posición (xz), calculadas fuera de cualquier if
vec2 snowVolGrad(vec2 p, float zone, vec2 dpx, vec2 dpy) {
  vec2 d1 = (snowReliefGrad(SNOW_R1 * p / uSnowDisp.y, SNOW_R1 * dpx / uSnowDisp.y, SNOW_R1 * dpy / uSnowDisp.y).gb * 2.0 - 1.0) * uSnowVolK.x;
  vec2 g = (d1 * SNOW_R1) * (uSnowDisp.x * zone / uSnowDisp.y);
  if (uSnowVolK.y <= 0.0) return g; // sin ondulaciones finas: una lectura menos
  vec2 d2 = (texture2D(uSnowVol, SNOW_R2 * p / uSnowDisp.z).gb * 2.0 - 1.0) * uSnowVolK.x;
  return g + (d2 * SNOW_R2) * (uSnowVolK.y / uSnowDisp.z);
}
#endif`;

/**
 * Orillas bajas sin dientes de sierra: cerca de la costa, la altura de cada vértice pasa a una rampa que cruza
 * el nivel del mar justo donde la distancia con signo a la costa ADD vale 0. El agua corta el terreno donde
 * su altura vale el nivel del mar, así que el borde del agua sigue la costa real (interpolada entre vértices)
 * y no la escalera de la grilla. Solo en orillas bajas (los acantilados no cambian) y con la misma función
 * de la posición en todos los bloques (sin grietas). Reconstrucción visual: los datos REMA no cambian.
 */
export const COAST_RAMP_VERTEX = `
#ifdef SNOW_VOL
if (uCoastRamp.w > 0.0) {
  float sdfC = (textureLod(uSurface, vSurfUv, 0.0).a * 255.0 - 128.0) / 8.0; // m, + tierra (recortada a ±16)
  vec3 wpC = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float bandC = 1.0 - smoothstep(uCoastRamp.z * 0.6, uCoastRamp.z, abs(sdfC));
  float lowC = 1.0 - smoothstep(uCoastRamp.y * 0.6, uCoastRamp.y, wpC.y - uSeaY);
  // Solo donde la costa ADD y la malla (REMA) coinciden: tierra sobre el agua con ADD diciendo tierra, o fondo
  // bajo el agua con ADD diciendo mar. Donde REMA mide hielo o nieve sobre el agua y ADD dice mar (hielo costero,
  // islas bajas), la rampa los hundía y la orilla quedaba como un contorno con huecos.
  float agreeC = (sdfC < 0.0 && wpC.y > uSeaY + 0.2) || (sdfC > 0.0 && wpC.y < uSeaY - 0.2) ? 0.0 : 1.0;
  float kC = bandC * lowC * agreeC * uCoastRamp.w;
  // Caras de cierre (corte del diorama): solo la parte de arriba sigue a la orilla. Sin esto, el fondo del corte
  // (cientos de metros bajo el agua) junto a cada orilla subía al nivel del mar y abría una ranura en diagonal.
  if (dot(vClosureNormal, vClosureNormal) > 0.5 && wpC.y < uSeaY - 5.0) kC = 0.0;
  if (kC > 0.0) {
    float yC = uSeaY + clamp(sdfC * uCoastRamp.x, -3.0, uCoastRamp.y);
    transformed.y += (yC - wpC.y) * kC;
  }
}
#endif`;
