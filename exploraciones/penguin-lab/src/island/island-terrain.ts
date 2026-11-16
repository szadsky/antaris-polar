/**
 * Isla de práctica para el pingüino: relieve SINTÉTICO generado por procedimiento, no geografía real
 * ni datos REMA. Módulo puro (sin Three.js ni DOM): se prueba en Node con check-island.mjs.
 *
 * Método (técnicas estándar de generación de terreno):
 *  1. Forma: máscara radial con deformación de dominio (domain warping) y fBm → costa fractal.
 *  2. Relieve: llanura costera suave + montañas con ruido ridged multifractal (Musgrave), concentradas
 *     en el fondo de la isla para dejar adelante una zona baja caminable.
 *  3. Erosión hidráulica por gotas (H. T. Beyer 2015; S. Lague): talla valles y canaletas y deposita
 *     sedimento al pie de las laderas. Se atenúa junto al mar para que la costa siga siendo continua.
 *  4. Hielo: glaciares donde la erosión acumula flujo (valles) dentro de la zona montañosa.
 *
 * Unidades: metros. Nivel del mar en y = 0. Grillas cuadradas centradas en el origen:
 * columna → x, fila → z, x = col · cell − half (la misma convención que SnowFootprints).
 */

// ─── Ruido determinista ──────────────────────────────────────────────────────
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruido de gradiente 2D (tipo Perlin), salida aproximada en [−1, 1]. */
export function createNoise(seed: number) {
  const random = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(16), gy = new Float32Array(16);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2 + 0.2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g00 = perm[X + perm[Y]] & 15, g10 = perm[X + 1 + perm[Y]] & 15, g01 = perm[X + perm[Y + 1]] & 15, g11 = perm[X + 1 + perm[Y + 1]] & 15;
    const n00 = gx[g00] * xf + gy[g00] * yf, n10 = gx[g10] * (xf - 1) + gy[g10] * yf;
    const n01 = gx[g01] * xf + gy[g01] * (yf - 1), n11 = gx[g11] * (xf - 1) + gy[g11] * (yf - 1);
    const u = fade(xf), v = fade(yf), a = n00 + (n10 - n00) * u;
    return 1.4 * (a + ((n01 + (n11 - n01) * u) - a) * v);
  };
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ─── Descripción de la isla ──────────────────────────────────────────────────
export type TerrainId = 'macizo' | 'valle' | 'sendero';
export interface IslandSpec {
  id: TerrainId;
  name: string;
  summary: string;
  seed: number;
  /** Radio medio de la costa (m). */
  radius: number;
  /** Altura máxima aproximada de las montañas antes de la erosión (m). */
  peak: number;
  /** Gotas de la erosión hidráulica. */
  droplets: number;
  /** Acimut de la cámara 3/4 (radianes; 0 = cámara al sur, en +z, mirando al norte). */
  viewAzimuth: number;
  /** Punto de aparición buscado: metros desde el origen hacia la cámara. */
  spawnAlong: number;
  /** Escala horizontal de las formas (el diseño se dibujó con 1) y escala de altura de las montañas. */
  scale: number;
  heightScale: number;
  /** Medio lado del dominio (m) y puntos por lado de la grilla fina (n − 1 múltiplo de 8). */
  half: number;
  n: number;
  /** Red de pasadizos: claros (x, z, radio, altura del piso, tipo) y conexiones; el nodo 0 es el inicio. */
  network?: { nodes: [number, number, number, number, NodeKind][]; edges: ([number, number] | [number, number, 'tobogan'])[] };
}

type NodeKind = 'claro' | 'laguna' | 'salida' | 'mirador' | 'pie';
/** Nodo de la red en coordenadas a lo largo (u, hacia el noroeste) y a lo ancho (v) de una isla diagonal. */
function node(u: number, v: number, radius: number, floor: number, kind: NodeKind): [number, number, number, number, NodeKind] {
  return [(-u + v) * Math.SQRT1_2, (-u - v) * Math.SQRT1_2, radius, floor, kind];
}

export const TERRAINS: IslandSpec[] = [
  {
    id: 'macizo',
    name: 'Macizo',
    summary: 'Llanura costera al frente, cordón erosionado con glaciares al fondo.',
    seed: 7,
    radius: 9.8,
    peak: 5.2,
    droplets: 14000,
    viewAzimuth: 0.55,
    spawnAlong: 3.5,
    scale: 1,
    heightScale: 1,
    half: 14,
    n: 1025, // 2,7 cm por celda
  },
  {
    id: 'valle',
    name: 'Valle encerrado',
    summary: 'Zona de navegación: un valle amplio para caminar libre, con una laguna helada, rodeado por un anillo de montañas; una abertura baja al mar.',
    seed: 13,
    // Diseño de 12,2 m de radio agrandado ×1,8: piso del valle de ~20 m de diámetro.
    radius: 12.2,
    scale: 1.8,
    heightScale: 1.6,
    peak: 5.0,
    droplets: 55000,
    viewAzimuth: 0.55,
    spawnAlong: 2.2,
    half: 25.6,
    n: 1281, // 4 cm por celda (las huellas siguen legibles; 2,7 cm costaría ~2,2 veces la memoria)
  },
  {
    id: 'sendero',
    name: 'Sendero',
    summary: 'Isla alargada con un circuito: sube por terrazas hasta una cumbre, baja por un tobogán de hielo a una laguna helada y vuelve por un valle bajo; un cordón de montañas separa la ida de la vuelta.',
    seed: 53,
    radius: 0, // la forma la da el recorrido
    scale: 1,
    heightScale: 1.5,
    peak: 5.0,
    droplets: 60000,
    viewAzimuth: Math.PI / 4, // la cámara mira a lo largo de la isla (de sudeste a noroeste)
    spawnAlong: 0,
    half: 30,
    n: 1281, // 4,7 cm por celda
    network: {
      // u: a lo largo de la isla (−22 inicio … +27 fondo) · v: a lo ancho (+ norte de la isla, − sur)
      nodes: [
        node(-22, 0, 4.5, 0.7, 'claro'),    // 0 playa de inicio
        node(-14, 5.5, 2, 1.0, 'claro'),    // 1 subida norte
        node(-5, 6.5, 2.2, 2.2, 'claro'),   // 2 terraza
        node(4.5, 6.5, 2.4, 3.4, 'claro'),  // 3 terraza alta
        node(14, 4.5, 3, 4.4, 'claro'),     // 4 meseta alta
        node(22.5, 2, 2.6, 5.3, 'mirador'), // 5 cumbre: arranque del tobogán
        node(6, -6, 4.5, 0.8, 'laguna'),    // 6 laguna helada (pie del tobogán)
        node(-6, -6.5, 3.5, 0.7, 'claro'),  // 7 valle sur
        node(-15, -5.5, 3.2, 0.75, 'claro'),// 8 valle sur, vuelta al inicio
        node(-4, -15, 2.5, 0.45, 'salida'), // 9 playa sur
        node(-12, 14, 2.5, 0.45, 'salida'), // 10 playa norte
      ],
      edges: [
        [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6, 'tobogan'], [6, 7], [7, 8], [8, 0],
        [2, 7], // paso por el cordón (atajo entre la ida y la vuelta)
        [7, 9], [1, 10],
      ],
    },
  },
];
export const ISLAND = TERRAINS[0];
/** Terreno que abre /pinguino-menu/ sin ?terreno=. */
export const DEFAULT_TERRAIN_ID = 'sendero';
export function terrainSpec(id: string | null) { return TERRAINS.find((t) => t.id === id) ?? TERRAINS.find((t) => t.id === DEFAULT_TERRAIN_ID)!; }

export const SEA_Y = 0;
/** Pendiente máxima caminable (tan 34°): las laderas rocosas y los frentes de hielo son obstáculos. */
export const MAX_WALK_SLOPE = Math.tan((34 * Math.PI) / 180);
/** Altura mínima sobre el agua para pisar: el pingüino se detiene en la orilla. */
export const SHORE_MARGIN = 0.1;

// ─── Generación en la grilla gruesa ──────────────────────────────────────────
type Noise2 = (x: number, y: number) => number;
function fbm(noise: Noise2, x: number, y: number, octaves: number) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) { sum += noise(x * f + o * 13.7, y * f - o * 7.1) * amp; amp *= 0.5; f *= 2.03; }
  return sum;
}
/** Ridged multifractal (Musgrave): crestas agudas con detalle que se apaga en los valles. */
function ridgedMF(noise: Noise2, x: number, y: number) {
  let sum = 0, f = 1, amp = 1, weight = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    let v = 1 - Math.abs(noise(x * f + o * 5.3, y * f - o * 3.9));
    v *= v; v *= weight; weight = clamp(v * 1.8, 0, 1);
    sum += v * amp; norm += amp; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}
const LOWLAND = 0.6, BEACH_SCALE = 0.32, SEA_DEPTH = 2.6, SEA_SCALE = (SEA_DEPTH * BEACH_SCALE) / LOWLAND;
/** Perfil costero en función de c (c > 0 tierra): playa de ~20° que se aplana tierra adentro. */
const coastProfile = (c: number) => c >= 0 ? LOWLAND * (1 - Math.exp(-c / BEACH_SCALE)) : -SEA_DEPTH * (1 - Math.exp(c / SEA_SCALE));

/** Relieve antes de la erosión según el terreno elegido. `lake`: laguna helada (0–1), si hay. */
export function baseRelief(spec: IslandSpec, m: number, half: number) {
  return spec.id === 'valle' ? valleyRelief(spec, m, half) : spec.id === 'sendero' ? networkRelief(spec, m, half) : massifRelief(spec, m, half);
}

/** Macizo: forma de la isla, llanura costera y un cordón al fondo. */
function massifRelief(spec: IslandSpec, m: number, half: number) {
  const cell = (half * 2) / (m - 1), heights = new Float32Array(m * m), zone = new Float32Array(m * m), lake = new Float32Array(m * m);
  const warpX = createNoise(spec.seed), warpZ = createNoise(spec.seed + 1), shapeN = createNoise(spec.seed + 2);
  const rollN = createNoise(spec.seed + 3), zoneN = createNoise(spec.seed + 4), ridgeN = createNoise(spec.seed + 5);
  const ridged = (x: number, y: number) => ridgedMF(ridgeN, x, y);
  const lowland = LOWLAND, beachScale = BEACH_SCALE, depth = SEA_DEPTH, seaScale = SEA_SCALE;
  const hs = 1, R = spec.radius;
  for (let row = 0; row < m; row++) for (let col = 0; col < m; col++) {
    const x0 = col * cell - half, z0 = row * cell - half;
    // Deformación de dominio (~8 m): costa y cordones sin simetría radial.
    const x = x0 + 2.2 * fbm(warpX, x0 / 8, z0 / 8, 3), z = z0 + 2.2 * fbm(warpZ, x0 / 8 + 4.1, z0 / 8 - 2.7, 3);
    const r = Math.hypot(x, z * 1.08) / R;
    // c > 0: tierra. Costa irregular por fBm de 3 octavas (bahías y cabos de 1,4 a 6 m; una cuarta octava
    // con esta deformación plegaba la costa en entradas de 0,4 m con puntas agudas).
    const c = 1 - r * r + 0.55 * fbm(shapeN, x / 5.5, z / 5.5, 3);
    let h = c >= 0 ? lowland * (1 - Math.exp(-c / beachScale)) : -depth * (1 - Math.exp(c / seaScale));
    const inland = smoothstep(0.12, 0.6, c);
    // Las montañas bajan al mar en espolones (rampa ancha), no en una pared paralela a la costa.
    const mountainLand = smoothstep(0.02, 0.85, c);
    // Zona montañosa: ruido de baja frecuencia sesgado hacia el norte (−z), lejos de la cámara.
    const zn = smoothstep(-0.1, 0.35, 0.9 * fbm(zoneN, x / 9, z / 9, 2) - 0.8 * z / R + 0.12) * mountainLand;
    zone[row * m + col] = zn;
    // Llanura: lomadas y afloramientos rocosos chicos (nunataks).
    const roll = fbm(rollN, x / 4.5, z / 4.5, 3);
    h += hs * (0.45 * roll + 1.4 * smoothstep(0.16, 0.42, roll) ** 2) * inland * (1 - zn);
    // Macizo: base ancha y redondeada; encima, crestas ridged multifractal.
    h += hs * (1.5 * zn + spec.peak * zn * Math.pow(ridged(x / 8.5, z / 8.5), 1.5));
    heights[row * m + col] = h;
  }
  return { heights, zone, lake, cell };
}

/**
 * Valle encerrado: un anillo de montañas (ridged multifractal sobre una banda circular de radio
 * irregular) rodea un valle con una laguna helada. El anillo se abre hacia la cámara en una abertura
 * baja que llega al mar: desde la vista 3/4 el valle se ve entero y el pingüino puede salir.
 */
/** Curva Catmull-Rom por los puntos del recorrido, muestreada cada ~0,25 m: puntos y longitud acumulada. */
export function routeCurve(points: [number, number][]) {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.25);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  const along = [0];
  for (let i = 1; i < out.length; i++) along.push(along[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { points: out, along, length: along[along.length - 1] };
}

/** Pasadizo o tobogán ya muestreado: puntos, parámetro 0–1 a lo largo, alturas de los extremos y semiancho. */
interface NetworkEdge { pts: [number, number][]; s: number[]; ha: number; hb: number; hw: number[]; slide: boolean; minX: number; maxX: number; minZ: number; maxZ: number }

/** Geometría de la red de pasadizos (compartida por el relieve y las pruebas). */
export function networkGeometry(spec: IslandSpec) {
  const net = spec.network!, random = mulberry32(spec.seed * 31 + 7), widthN = createNoise(spec.seed + 9);
  const edges: NetworkEdge[] = net.edges.map(([ia, ib, kind]) => {
    const a = net.nodes[ia], b = net.nodes[ib], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), slide = kind === 'tobogan';
    // Pasadizos serpenteantes: punto medio corrido hacia un costado; los toboganes son casi rectos.
    const off = (random() * 2 - 1) * (slide ? 0.04 : 0.15) * len;
    const mid: [number, number] = [a[0] + dx / 2 - (dz / len) * off, a[1] + dz / 2 + (dx / len) * off];
    const curve = routeCurve([[a[0], a[1]], mid, [b[0], b[1]]]);
    // Parámetro a lo largo: la diferencia de altura se reparte solo en el tramo libre entre los dos claros
    // (descontando sus radios), con pendiente pareja; si no, las rampas quedaban empinadas junto a los claros.
    // Mismo radio efectivo que usa el relieve (claros y laguna 1 m más amplios): si la rampa terminaba en el
    // radio nominal, en ese último metro el piso del claro le ganaba y quedaba un escalón empinado.
    const eff = (n: typeof a) => n[2] + (n[4] === 'claro' || n[4] === 'laguna' ? 1 : 0), ra = eff(a), rb = eff(b);
    const s = curve.along.map((v) => clamp((v - ra) / Math.max(1e-3, curve.length - ra - rb), 0, 1));
    // Semiancho irregular a lo largo (1,7–3,1 m: pasadizos de ~4 a 6 m); el tobogán, parejo (1,8 m).
    const hw = curve.points.map(([x, z]) => slide ? 1.8 : 2.4 + 0.7 * widthN(x / 5, z / 5));
    const xs = curve.points.map((p) => p[0]), zs = curve.points.map((p) => p[1]);
    return { pts: curve.points, s, ha: a[3], hb: b[3], hw, slide, minX: Math.min(...xs) - 3, maxX: Math.max(...xs) + 3, minZ: Math.min(...zs) - 3, maxZ: Math.max(...zs) + 3 };
  });
  return { nodes: net.nodes, edges };
}

/**
 * Sendero: isla alargada con un circuito. La red (claros, terrazas y rampas a distintas alturas, un
 * tobogán de hielo) define los pisos caminables y también la forma de la isla: la costa queda a ~6–9 m
 * de la red, no es un círculo. Afuera de los pisos crece la montaña (ridged multifractal con masa
 * variable: cumbres y collados), con erosión hidráulica encima; los pisos no se erosionan.
 */
function networkRelief(spec: IslandSpec, m: number, half: number) {
  const cell = (half * 2) / (m - 1), heights = new Float32Array(m * m), zone = new Float32Array(m * m), lake = new Float32Array(m * m);
  const keep = new Float32Array(m * m);
  const warpX = createNoise(spec.seed), warpZ = createNoise(spec.seed + 1), shapeN = createNoise(spec.seed + 2);
  const rollN = createNoise(spec.seed + 3), massN = createNoise(spec.seed + 4), ridgeN = createNoise(spec.seed + 5);
  const { nodes, edges } = networkGeometry(spec), hs = spec.heightScale;
  const terraces = nodes.filter((n) => n[4] === 'mirador'), lakeNode = nodes.find((n) => n[4] === 'laguna');
  const exits = nodes.filter((n) => n[4] === 'salida');
  /** 1 en una salida a la playa, 0 lejos (campana de ~7 m alrededor del nodo). */
  const beachAt = (x: number, z: number) => { let b = 0; for (const e of exits) b = Math.max(b, Math.exp(-((Math.hypot(x - e[0], z - e[1]) / 7) ** 2))); return b; };
  // Primera pasada: distancia "afuera" de la red (o < 0: dentro de un piso), altura del piso (promedio
  // ponderado suave: continua entre pisos a distinta altura), tobogán y campo de tierra.
  const O = new Float32Array(m * m), F = new Float32Array(m * m), S = new Float32Array(m * m), cRaw = new Float32Array(m * m);
  const items: [number, number][] = [];
  for (let row = 0; row < m; row++) for (let col = 0; col < m; col++) {
    const x0 = col * cell - half, z0 = row * cell - half, i = row * m + col;
    // La red se mide en coordenadas deformadas (~1,4 m, ondas de ~7 m): claros y pasadizos de borde
    // irregular, no círculos y caños.
    const xn = x0 + 1.4 * fbm(warpX, x0 / 7 + 3.3, z0 / 7 - 1.7, 2), zn = z0 + 1.4 * fbm(warpZ, x0 / 7 - 6.1, z0 / 7 + 2.2, 2);
    let o = Infinity, wSum = 0, fSum = 0, onSlide = 0;
    items.length = 0;
    // Claros y laguna 1 m más amplios que su radio nominal: zonas abiertas.
    for (const n of nodes) items.push([Math.hypot(xn - n[0], zn - n[1]) - n[2] - (n[4] === 'claro' || n[4] === 'laguna' ? 1.0 : 0), n[3]]);
    for (const e of edges) {
      if (xn < e.minX - 12 || xn > e.maxX + 12 || zn < e.minZ - 12 || zn > e.maxZ + 12) continue;
      let best = Infinity, k = 0;
      for (let p = 0; p < e.pts.length; p++) { const d = (e.pts[p][0] - xn) ** 2 + (e.pts[p][1] - zn) ** 2; if (d < best) { best = d; k = p; } }
      const oi = Math.sqrt(best) - e.hw[k];
      items.push([oi, e.ha + (e.hb - e.ha) * e.s[k]]);
      if (e.slide) onSlide = Math.max(onSlide, 1 - smoothstep(-0.25, 0.25, oi));
    }
    for (const [oi] of items) o = Math.min(o, oi);
    for (const [oi, fh] of items) { const w = Math.exp(-(oi - o) / 0.7); wSum += w; fSum += w * fh; }
    O[i] = o; F[i] = fSum / wSum; S[i] = onSlide;
    const x = x0 + 1.2 * fbm(warpX, x0 / 12, z0 / 12, 2), z = z0 + 1.2 * fbm(warpZ, x0 / 12 + 4.1, z0 / 12 - 2.7, 2);
    // Tierra hasta ~6–9 m afuera de la red (borde irregular por fBm); junto a las salidas, la costa se
    // acerca a ~3,5 m: playas a las que se llega caminando.
    const landW = (7.5 + 2.4 * fbm(shapeN, x / 9, z / 9, 3)) * (1 - 0.55 * beachAt(x0, z0));
    // Lineal con la distancia: la orilla tiene pendiente pareja (cuadrático, se empinaba junto a la costa).
    cRaw[i] = 1 - Math.max(0, o) / landW;

  }
  // La distancia a la red tiene pliegues (donde dos tramos quedan equidistantes): suavizado de ~1 m para
  // que la costa salga sin cúspides.
  const cField = blur(cRaw, m, 3);
  for (let row = 0; row < m; row++) for (let col = 0; col < m; col++) {
    const x0 = col * cell - half, z0 = row * cell - half, i = row * m + col;
    const x = x0 + 1.2 * fbm(warpX, x0 / 12, z0 / 12, 2), z = z0 + 1.2 * fbm(warpZ, x0 / 12 + 4.1, z0 / 12 - 2.7, 2);
    const c = cField[i], o = O[i], inland = smoothstep(0.12, 0.6, c), mountainLand = smoothstep(0.12, 0.6, c); // la montaña arranca ~1 m tierra adentro: sin acantilado justo en la orilla
    // La playa sube directo hasta la altura del piso de cada lugar (sin pasar por 0,6 m): sin lomo en la orilla.
    let h = c >= 0 ? F[i] * (1 - Math.exp(-c / BEACH_SCALE)) : coastProfile(c * 2); // el fondo baja el doble de rápido
    // Montaña afuera de los pisos: laderas que suben en ~3,2 m, cumbres y collados irregulares.
    // Playas: junto a las salidas no hay montaña (el piso baja suave hasta el agua).
    const mask = smoothstep(0, 3.2, o) * (1 - beachAt(x0, z0)) ** 2;
    const mass = 0.5 + 0.8 * smoothstep(-0.45, 0.4, fbm(massN, x / 11, z / 11, 2));
    let lookout = 0;
    for (const t of terraces) lookout = Math.max(lookout, Math.exp(-((Math.hypot(x0 - t[0], z0 - t[1]) / (t[2] + 3)) ** 2)));
    const mountain = hs * mass * (2.4 + spec.peak * Math.pow(ridgedMF(ridgeN, x / 6.5, z / 6.5), 1.3)) * (1 - 0.6 * lookout);
    const roll = fbm(rollN, x / 4, z / 4, 2);
    // Pisos: la altura de la red (terrazas, rampas); afuera, montaña por encima del piso más cercano.
    h += inland * 0.1 * roll * (1 - mask) + mountainLand * mask * mountain;
    zone[i] = mask * mountainLand;
    keep[i] = (1 - smoothstep(0.2, 1.4, o)) * inland;
    const lakeMask = lakeNode ? 1 - smoothstep(lakeNode[2] - 1.2, lakeNode[2] - 0.6, Math.hypot(x0 - lakeNode[0], z0 - lakeNode[1])) : 0;
    lake[i] = Math.max(lakeMask, S[i]) * inland;
    heights[i] = h;
  }
  // Franja de la orilla (|h| < 0,3 m): suavizado extra para que la costa no zigzaguee en lo casi plano.
  const smooth = blur(heights, m, 2);
  for (let i = 0; i < m * m; i++) { const w = 1 - smoothstep(0.15, 0.3, Math.abs(heights[i])); if (w > 0) heights[i] += (smooth[i] - heights[i]) * w; }
  return { heights, zone, lake, keep, cell };
}


function valleyRelief(spec: IslandSpec, m: number, half: number) {
  const cell = (half * 2) / (m - 1), heights = new Float32Array(m * m), zone = new Float32Array(m * m), lake = new Float32Array(m * m);
  const warpX = createNoise(spec.seed), warpZ = createNoise(spec.seed + 1), shapeN = createNoise(spec.seed + 2);
  const rollN = createNoise(spec.seed + 3), ringN = createNoise(spec.seed + 4), ridgeN = createNoise(spec.seed + 5);
  const R = spec.radius, a = spec.viewAzimuth, gx = Math.sin(a), gz = Math.cos(a), k = spec.scale, hs = spec.heightScale;
  // El valle está algo corrido hacia el fondo: más montaña detrás que delante.
  const vcx = -gx * 0.9, vcz = -gz * 0.9;
  for (let row = 0; row < m; row++) for (let col = 0; col < m; col++) {
    // Coordenadas de diseño: el valle se agranda ×scale sin cambiar sus formas.
    const x0 = (col * cell - half) / k, z0 = (row * cell - half) / k, i = row * m + col;
    const x = x0 + 1.6 * fbm(warpX, x0 / 8, z0 / 8, 3), z = z0 + 1.6 * fbm(warpZ, x0 / 8 + 4.1, z0 / 8 - 2.7, 3);
    const c = 1 - (Math.hypot(x, z * 1.05) / R) ** 2 + 0.45 * fbm(shapeN, x / 6, z / 6, 3);
    let h = coastProfile(c);
    const inland = smoothstep(0.12, 0.6, c), mountainLand = smoothstep(0.0, 0.45, c);
    const dx = x - vcx, dz = z - vcz, d = Math.hypot(dx, dz), dir = Math.atan2(dx, dz);
    // Ángulo respecto de la dirección de la cámara (0 = hacia la cámara, ±π = el fondo).
    let toCamera = dir - a; toCamera = Math.atan2(Math.sin(toCamera), Math.cos(toCamera));
    // Radio del anillo irregular: ruido sobre el círculo unidad (periódico en el ángulo).
    const ringR = 7.0 + 0.8 * fbm(ringN, Math.cos(dir) * 1.3, Math.sin(dir) * 1.3, 2);
    const band = Math.exp(-(((d - ringR) / 2.5) ** 2));
    const opening = smoothstep(0.2, 0.55, Math.abs(toCamera));            // abertura de ~±18° hacia la cámara
    const back = 0.7 + 0.45 * smoothstep(0.8, 2.6, Math.abs(toCamera));    // cumbres más altas al fondo
    const zn = band * opening * mountainLand;
    zone[i] = zn;
    const roll = fbm(rollN, x / 4, z / 4, 3);
    // Piso del valle: cuenca suave a ~0,75 m, un poco más alta que la playa.
    const floor = (1 - smoothstep(ringR - 2.4, ringR - 0.6, d)) * inland;
    h += (0.15 + 0.3 * roll) * floor + 0.35 * roll * inland * (1 - floor) * (1 - zn);
    // Base continua del anillo (2,7 m × heightScale) para que encierre el valle; encima, cumbres y collados.
    h += hs * (2.7 * zn * back + spec.peak * zn * back * Math.pow(ridgedMF(ridgeN, x / 7, z / 7), 1.4));
    // Laguna helada en el centro del valle: plana, apenas hundida.
    const lk = 1 - smoothstep(1.7, 2.6, d);
    if (lk > 0) h += (0.55 - h) * lk * inland;
    lake[i] = (1 - smoothstep(1.6, 2.1, d)) * inland;
    heights[i] = h;
  }
  return { heights, zone, lake, cell };
}

export interface ErosionResult { flow: Float32Array; ms: number }

/**
 * Erosión hidráulica por gotas (Beyer 2015, implementación de referencia de S. Lague, MIT).
 * Trabaja en alturas normalizadas por `scale`. Las gotas que llegan al mar se pierden (sin delta).
 * Devuelve también el flujo acumulado por celda (para ubicar valles y glaciares).
 */
export function erode(heights: Float32Array, m: number, seed: number, droplets: number, scale = 6): ErosionResult {
  const started = performance.now(), random = mulberry32(seed * 977 + 3), map = heights, flow = new Float32Array(m * m);
  for (let i = 0; i < map.length; i++) map[i] /= scale;
  const inertia = 0.05, capacityFactor = 4, minCapacity = 0.01, erodeSpeed = 0.3, depositSpeed = 0.3, evaporate = 0.015, gravity = 4, maxLife = 32, radius = 3;
  // Pincel de erosión: pesos lineales en un círculo de `radius` celdas.
  const brushDx: number[] = [], brushDz: number[] = [], brushW: number[] = [];
  let wSum = 0;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) { const d = Math.hypot(dx, dz); if (d <= radius) { brushDx.push(dx); brushDz.push(dz); brushW.push(1 - d / radius); wSum += 1 - d / radius; } }
  for (let k = 0; k < brushW.length; k++) brushW[k] /= wSum;
  const sea = SEA_Y / scale;
  const heightGrad = (px: number, pz: number) => {
    const cx = Math.floor(px), cz = Math.floor(pz), u = px - cx, v = pz - cz, i = cz * m + cx;
    const a = map[i], b = map[i + 1], c = map[i + m], d = map[i + m + 1];
    return { h: a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v, gx: (b - a) * (1 - v) + (d - c) * v, gz: (c - a) * (1 - u) + (d - b) * u };
  };
  for (let n = 0; n < droplets; n++) {
    let px = 1 + random() * (m - 3), pz = 1 + random() * (m - 3);
    if (map[Math.floor(pz) * m + Math.floor(px)] <= sea + 0.02) continue; // nace solo sobre tierra
    let dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < maxLife; life++) {
      const cx = Math.floor(px), cz = Math.floor(pz), u = px - cx, v = pz - cz, i = cz * m + cx;
      const here = heightGrad(px, pz);
      dx = dx * inertia - here.gx * (1 - inertia); dz = dz * inertia - here.gz * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-9) break;
      dx /= len; dz /= len; px += dx; pz += dz;
      flow[i] += water;
      if (px < 1 || pz < 1 || px >= m - 2 || pz >= m - 2) break;
      const next = heightGrad(px, pz).h;
      if (next < sea) break; // llegó al mar: el sedimento se pierde, la costa no recibe depósitos
      const dh = next - here.h;
      const capacity = Math.max(-dh * speed * water * capacityFactor, minCapacity);
      if (sediment > capacity || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositSpeed;
        sediment -= amount;
        map[i] += amount * (1 - u) * (1 - v); map[i + 1] += amount * u * (1 - v); map[i + m] += amount * (1 - u) * v; map[i + m + 1] += amount * u * v;
      } else {
        const amount = Math.min((capacity - sediment) * erodeSpeed, -dh);
        for (let k = 0; k < brushW.length; k++) {
          const bx = cx + brushDx[k], bz = cz + brushDz[k];
          if (bx < 0 || bz < 0 || bx >= m || bz >= m) continue;
          const j = bz * m + bx, take = Math.min(map[j], amount * brushW[k]);
          map[j] -= take; sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
    }
  }
  for (let i = 0; i < map.length; i++) map[i] *= scale;
  return { flow, ms: performance.now() - started };
}

function blur(src: Float32Array, m: number, passes: number) {
  let a = src.slice(), b = new Float32Array(m * m);
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < m; r++) for (let c = 0; c < m; c++) {
      let s = 0, w = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= m || cc >= m) continue;
        const k = (dr === 0 ? 2 : 1) * (dc === 0 ? 2 : 1); s += a[rr * m + cc] * k; w += k;
      }
      b[r * m + c] = s / w;
    }
    [a, b] = [b, a];
  }
  return a;
}

/** Relieve final y hielo en la grilla gruesa (m × m). */
export function generateIsland(spec: IslandSpec, m: number, half: number) {
  const base = baseRelief(spec, m, half);
  const eroded = base.heights.slice();
  const erosion = erode(eroded, m, spec.seed, spec.droplets, 6 * spec.heightScale);
  // Cambio de la erosión suavizado una vez (sin escalones de una celda) y atenuado junto al mar:
  // la línea de costa la define el relieve base, que es continuo.
  const delta = new Float32Array(m * m);
  for (let i = 0; i < delta.length; i++) delta[i] = eroded[i] - base.heights[i];
  const smoothDelta = blur(delta, m, 1);
  const heights = new Float32Array(m * m);
  for (let i = 0; i < heights.length; i++) {
    const keep = "keep" in base ? (base.keep as Float32Array)[i] : 0; // pisos de la red: sin erosión
    heights[i] = base.heights[i] + smoothDelta[i] * smoothstep(0.12, 0.5, base.heights[i]) * (1 - keep);
    // La erosión nunca convierte tierra en mar: donde las montañas llegan a la costa, una canaleta
    // tallada bajo el nivel del agua cortaba la orilla en dientes. La costa queda la del relieve base.
    if (base.heights[i] > 0) heights[i] = Math.max(heights[i], Math.min(base.heights[i], 0.05));
  }
  // Glaciares: valles (flujo acumulado alto) dentro de la zona montañosa, con bordes suaves.
  let maxFlow = 0;
  for (const f of erosion.flow) maxFlow = Math.max(maxFlow, f);
  const valley = blur(Float32Array.from(erosion.flow, (f) => Math.log1p(f) / Math.log1p(maxFlow)), m, 1);
  const zone = blur(base.zone, m, 2);
  const iceRaw = new Float32Array(m * m);
  for (let i = 0; i < iceRaw.length; i++) iceRaw[i] = smoothstep(0.5, 0.62, valley[i]) * smoothstep(0.35, 0.65, zone[i]) * smoothstep(0.8, 1.4, heights[i]);
  const ice = blur(iceRaw, m, 2);
  // Laguna helada (si el terreno la tiene): hielo plano en el piso del valle.
  for (let i = 0; i < ice.length; i++) ice[i] = Math.max(smoothstep(0.35, 0.65, ice[i]), base.lake[i]);
  return { heights, ice, erosionMs: erosion.ms };
}

/**
 * Ampliación por un factor entero con Catmull-Rom separable: pasa exactamente por las muestras
 * gruesas y es C¹, así que las normales de la grilla fina no muestran la grilla gruesa.
 */
export function upsample(coarse: Float32Array, m: number, factor: number) {
  const n = (m - 1) * factor + 1, rows = new Float32Array(m * n), out = new Float32Array(n * n);
  const w = Array.from({ length: factor }, (_, k) => { const t = k / factor; return [(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2]; });
  const at = (a: Float32Array, stride: number, base: number, i: number) => a[base + Math.min(m - 1, Math.max(0, i)) * stride];
  for (let r = 0; r < m; r++) for (let c = 0; c < n; c++) {
    const i = Math.floor(c / factor), f = c % factor, k = w[f];
    rows[r * n + c] = f === 0 ? coarse[r * m + i] : k[0] * at(coarse, 1, r * m, i - 1) + k[1] * at(coarse, 1, r * m, i) + k[2] * at(coarse, 1, r * m, i + 1) + k[3] * at(coarse, 1, r * m, i + 2);
  }
  for (let r = 0; r < n; r++) {
    const i = Math.floor(r / factor), f = r % factor, k = w[f];
    for (let c = 0; c < n; c++) out[r * n + c] = f === 0 ? rows[i * n + c] : k[0] * at(rows, n, c, i - 1) + k[1] * at(rows, n, c, i) + k[2] * at(rows, n, c, i + 1) + k[3] * at(rows, n, c, i + 2);
  }
  return out;
}

// ─── Terreno de la escena ────────────────────────────────────────────────────
export class IslandTerrain {
  /** Alturas en la grilla fina (n × n, 2,7 cm con los valores por defecto). */
  readonly heights: Float32Array;
  /** Máscara de hielo en la grilla de la malla (iceN × iceN, 10,9 cm). */
  readonly iceGrid: Float32Array;
  readonly iceN: number;
  /** Alturas de la grilla de generación (21,9 cm), antes de ampliar. */
  readonly coarse: Float32Array;
  readonly coarseN: number;
  readonly cell: number;
  readonly seaY = SEA_Y;
  readonly erosionMs: number;
  /** `n − 1` debe ser múltiplo de 8: se genera en 1 de cada 8 puntos y se amplía ×2 (malla) y ×4 (fina). */
  constructor(readonly spec: IslandSpec = ISLAND, readonly n = spec.n, readonly half = spec.half) {
    if ((n - 1) % 8) throw new Error('IslandTerrain: n − 1 debe ser múltiplo de 8');
    this.cell = (half * 2) / (n - 1);
    this.coarseN = (n - 1) / 8 + 1;
    const island = generateIsland(spec, this.coarseN, half);
    this.coarse = island.heights;
    this.erosionMs = island.erosionMs;
    this.iceN = (n - 1) / 4 + 1;
    const mesh = upsample(island.heights, this.coarseN, 2);
    this.iceGrid = upsample(island.ice, this.coarseN, 2).map((v) => clamp(v, 0, 1));
    this.heights = upsample(mesh, this.iceN, 4);
  }
  private bilinear(grid: Float32Array, n: number, x: number, z: number) {
    const cell = (this.half * 2) / (n - 1), gx = clamp((x + this.half) / cell, 0, n - 1), gz = clamp((z + this.half) / cell, 0, n - 1);
    const ix = Math.min(Math.floor(gx), n - 2), iz = Math.min(Math.floor(gz), n - 2), fx = gx - ix, fz = gz - iz, i = iz * n + ix;
    return (grid[i] * (1 - fx) + grid[i + 1] * fx) * (1 - fz) + (grid[i + n] * (1 - fx) + grid[i + n + 1] * fx) * fz;
  }
  /** Altura bilineal de la grilla fina. */
  sample(x: number, z: number) { return this.bilinear(this.heights, this.n, x, z); }
  /** Pendiente (m/m) con diferencias centradas a ±e m: estable frente al detalle de la grilla. */
  /** Gradiente de la altura [dh/dx, dh/dz] a ±e m (para acelerar el deslizamiento en bajada). */
  gradient(x: number, z: number, e = 0.15): [number, number] {
    return [(this.sample(x + e, z) - this.sample(x - e, z)) / (2 * e), (this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e)];
  }
  slope(x: number, z: number, e = 0.08) {
    return Math.hypot(this.sample(x + e, z) - this.sample(x - e, z), this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e);
  }
  /** 0 = nieve o roca, 1 = hielo (glaciares). */
  ice(x: number, z: number) { return this.bilinear(this.iceGrid, this.iceN, x, z); }
  canStand(x: number, z: number) {
    if (Math.abs(x) > this.half - 0.5 || Math.abs(z) > this.half - 0.5) return false;
    return this.sample(x, z) > this.seaY + SHORE_MARGIN && this.slope(x, z) <= MAX_WALK_SLOPE;
  }
  /** Donde puede caer o aterrizar el pingüino: dentro de la isla y fuera del agua (la pendiente no importa). */
  canLand(x: number, z: number) {
    return Math.abs(x) <= this.half - 0.5 && Math.abs(z) <= this.half - 0.5 && this.sample(x, z) > this.seaY + SHORE_MARGIN;
  }
  /** Nieve blanda donde quedan huellas: no en hielo ni en laderas casi rocosas. */
  isSoftSnow(x: number, z: number) { return this.ice(x, z) < 0.5 && this.slope(x, z) < 0.6; }
}

/**
 * Punto de aparición: llano, caminable y lo más cerca posible de la costa del lado de la cámara
 * (recorridos cortos al empezar, con la isla delante).
 */
export function findSpawn(t: IslandTerrain) {
  const a = t.spec.viewAzimuth, dx = Math.sin(a), dz = Math.cos(a);
  // Pasadizos: arranca en el claro de inicio (nodo 0); si no, del lado de la cámara.
  let tx = dx * t.spec.spawnAlong, tz = dz * t.spec.spawnAlong;
  if (t.spec.network) [tx, tz] = t.spec.network.nodes[0];
  let best: { x: number; z: number; score: number } | null = null;
  for (let z = -t.half + 1; z < t.half - 1; z += 0.25) for (let x = -t.half + 1; x < t.half - 1; x += 0.25) {
    const h = t.sample(x, z);
    if (h < 0.3 || h > 1.2 || t.slope(x, z) > 0.25) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) ok = t.canStand(x + Math.cos(k * 0.785) * 1.2, z + Math.sin(k * 0.785) * 1.2);
    if (!ok) continue;
    const score = -Math.hypot(x - tx, z - tz);
    if (!best || score > best.score) best = { x, z, score };
  }
  if (!best) throw new Error('Isla sin lugar caminable para la aparición');
  return { x: best.x, z: best.z, yaw: a - 0.75 };
}
