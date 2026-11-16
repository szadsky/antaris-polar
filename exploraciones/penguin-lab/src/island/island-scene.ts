import * as THREE from 'three';
import { styleUniforms, stylizedMaterial } from '../snow/shaders';
import { createOcean, oceanShore, coastDistanceSampler } from '../snow/ocean';
import { createIslandIcebergs } from './island-icebergs';
import { SnowFootprints } from '../snow-footprints';
import { IslandTerrain, findSpawn, type IslandSpec } from './island-terrain';
import { buildIslandMaps, writeSurfaceTexel, type IslandMaps } from './island-maps';

/** Dirección hacia el sol (sin normalizar). La sombra del relieve se hornea con la misma dirección. */
export const SUN_DIRECTION: [number, number, number] = [-3, 4.5, 3.5];

/**
 * El agua (la del visor, opaca) tapa todo lo que queda bajo el nivel del mar: los cuadros de la malla con sus cuatro
 * vértices más de 2 cm bajo el agua no se dibujan.
 */
const UNDER_WATER_M = 0.02;
/** Escala del agua del visor en la isla: metros del visor por metro de la isla (ver snow/ocean.ts). */
export const WATER_SCALE = 30;

type Region ={ x0: number; x1: number; z0: number; z1: number };

/**
 * Suelo de isla para el laboratorio: malla de 257 × 257 vértices (10,9 cm), texturas de 1025² y 256²
 * con los canales del material de nieve de Antaris, agua translúcida y huellas en la nieve blanda.
 * Relieve SINTÉTICO: no es geografía real ni datos REMA.
 */
export class IslandGround {
  readonly terrain: IslandTerrain;
  readonly footprints: SnowFootprints;
  readonly group = new THREE.Group();
  readonly uniforms: ReturnType<typeof styleUniforms>;
  readonly spawn: { x: number; z: number; yaw: number };
  readonly timings: { terrainMs: number; mapsMs: number; materialMs: number; meshMs: number };
  readonly ocean: ReturnType<typeof createOcean>;
  readonly icebergs: ReturnType<typeof createIslandIcebergs>;
  /** Tiempo de CPU acumulado en actualizar huellas (ms), para el indicador de rendimiento. */
  cpuMs = 0;
  private readonly surface: Uint8Array;
  private readonly surfaceTexture: THREE.DataTexture;
  private readonly geometry: THREE.BufferGeometry;
  private readonly position: THREE.BufferAttribute;
  private readonly normal: THREE.BufferAttribute;
  private readonly stride = 4;
  private readonly vertsPerRow: number;
  /** Copia en CPU de la cadena de mipmaps de `surface` (nivel 0 = la textura misma). */
  private readonly mips: Uint8Array[] = [];
  private readonly mipSizes: number[] = [];
  private pending: Region | null = null;

  constructor(spec: IslandSpec, opts: { terrain?: IslandTerrain; maps?: IslandMaps; mobile?: boolean; maxAniso?: number } = {}) {
    let start = performance.now();
    const t = (this.terrain = opts.terrain ?? new IslandTerrain(spec));
    const terrainMs = performance.now() - start;
    start = performance.now();
    const maps = opts.maps ?? buildIslandMaps(t, SUN_DIRECTION);
    const mapsMs = performance.now() - start;
    start = performance.now();
    this.spawn = findSpawn(t);
    this.surface = maps.surface;
    const texture = (data: Uint8Array, size: number) => {
      const tex = new THREE.DataTexture(data, size, size);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      return tex;
    };
    this.surfaceTexture = texture(maps.surface, t.n);
    // Cadena de mipmaps en CPU (tamaños de WebGL 2: floor(n / 2) por nivel), para actualizar regiones.
    this.mips.push(maps.surface); this.mipSizes.push(t.n);
    for (let size = t.n >> 1; size >= 1; size >>= 1) {
      const below = this.mips[this.mips.length - 1], bs = this.mipSizes[this.mipSizes.length - 1], data = new Uint8Array(size * size * 4);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) for (let k = 0; k < 4; k++)
        data[(r * size + c) * 4 + k] = (below[((2 * r) * bs + 2 * c) * 4 + k] + below[((2 * r) * bs + 2 * c + 1) * 4 + k] + below[((2 * r + 1) * bs + 2 * c) * 4 + k] + below[((2 * r + 1) * bs + 2 * c + 1) * 4 + k] + 2) >> 2;
      this.mips.push(data); this.mipSizes.push(size);
    }
    const light = texture(maps.light, maps.lightSize);
    const materialStart = performance.now();
    // Genera (una sola vez) las texturas procedurales del material compartido: ruido y detalle.
    this.uniforms = styleUniforms({ surface: this.surfaceTexture, light }, { halfSize: [1000, 1000], seaY: t.seaY, texCellM: 4 } /* nieve suavizada con sesgo 2, como antes */);
    const materialMs = performance.now() - materialStart;
    const u = this.uniforms;
    // Escala de un pingüino: sin desplazamiento kilométrico de la nieve ni rampa costera (como la plataforma).
    u.uSnowDisp.value.x = 0;
    u.uCoastRamp.value.w = 0;
    // Fondo bajo el agua: transición en metros a escala de la isla (el visor usa 16–30 m).
    u.uSeaBedDepth.value.set(0.25, 1.2);
    // Fondo de la orilla mucho más oscuro que en el visor (albedo lineal ~0,07): con la luz del laboratorio
    // y agua de pocos cm, la grava gris claro se veía como nieve y la isla parecía más grande que su parte
    // caminable.
    u.uSeaBed.value.set(0.06, 0.085, 0.09);
    u.uSeaBedMid.value.set(0.03, 0.05, 0.06);
    this.footprints = new SnowFootprints(t.half, t.n);

    // ── Malla ───────────────────────────────────────────────────────────────
    const m = (this.vertsPerRow = (t.n - 1) / this.stride + 1);
    const positions = new Float32Array(m * m * 3), normals = new Float32Array(m * m * 3), uvs = new Float32Array(m * m * 2);
    for (let row = 0; row < m; row++) for (let col = 0; col < m; col++) {
      const v = row * m + col, fc = col * this.stride, fr = row * this.stride;
      positions.set([fc * t.cell - t.half, t.heights[fr * t.n + fc], fr * t.cell - t.half], v * 3);
      uvs.set([(fc + 0.5) / t.n, (fr + 0.5) / t.n], v * 2);
      this.writeNormal(normals, v, fc, fr);
    }
    const all = new Uint32Array((m - 1) * (m - 1) * 6);
    let k = 0;
    const y = (v: number) => positions[v * 3 + 1], under = t.seaY - UNDER_WATER_M;
    for (let row = 0; row < m - 1; row++) for (let col = 0; col < m - 1; col++) {
      const a = row * m + col, b = a + 1, c = a + m, d = c + 1;
      // Bajo el agua opaca: no se dibuja ni se sombrea.
      if (Math.max(y(a), y(b), y(c), y(d)) < under) continue;
      // Diagonal alternada: sin sesgo de dirección en las facetas de la costa.
      if ((row + col) & 1) all.set([a, c, b, b, c, d], k); else all.set([a, c, d, a, d, b], k);
      k += 6;
    }
    const indices = all.slice(0, k);
    const geometry = (this.geometry = new THREE.BufferGeometry());
    this.position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.normal = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('surfUv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();

    const snow = stylizedMaterial(u, { variant: 'n', exactCoast: true });
    const compileSnow = snow.onBeforeCompile.bind(snow);
    snow.onBeforeCompile = (shader, renderer) => {
      compileSnow(shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        // Huellas: normal de contacto sin suavizar donde la cavidad marca una huella (igual que la plataforma).
        .replace('normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);',
          'vec3 footN=vec3(surf.r*2.0-1.0,0.0,surf.g*2.0-1.0); footN.y=sqrt(max(0.0,1.0-dot(footN.xz,footN.xz))); float footWeight=1.0-smoothstep(.985,1.0,surf.b); normal=normalize((viewMatrix*vec4(normalize(gN+(footN-nSm)*footWeight),0.0)).xyz);')
        // Hielo explícito de la isla (canal A de la textura de luz): glaciares, lagunas y puentes.
        .replace('gSnowK = (1.0 - rockT) * (1.0 - isSea) * (1.0 - iceT);',
          'float iceM = 1.0 - lgt.a; iceT = max(iceT, iceM); rockT *= 1.0 - iceM;\ngSnowK = (1.0 - rockT) * (1.0 - isSea) * (1.0 - iceT);')
        // Orilla bajo el agua a escala de la isla (en el visor, la franja es de 0,9 m de altura).
        .replace('smoothstep(-0.8, 0.1, vWorld.y - uSeaY)', 'smoothstep(-0.07, 0.01, vWorld.y - uSeaY)')
        // Bajo el agua no hay brillo de nieve (satinado, destellos).
        .replace('gSnowK = (1.0 - rockT)', 'gSnowK = step(uSeaY, vWorld.y) * (1.0 - rockT)');
    };
    snow.customProgramCacheKey = () => 'antaris-island-snow-v1';
    const ground = new THREE.Mesh(geometry, snow);
    ground.receiveShadow = true;
    ground.name = 'isla';
    this.group.add(ground);
    // Isla para el reflejo del agua: los mismos vértices y el mismo material (sin programa nuevo), uno de cada 4 por
    // lado (~1/16 de los triángulos). El reflejo va deformado por el oleaje y a 512 px: no se nota y cuesta mucho menos.
    const coarse: number[] = [], R = 4;
    for (let row = 0; row + R < m; row += R) for (let col = 0; col + R < m; col += R) {
      const a = row * m + col, b = a + R, c = a + R * m, d = c + R;
      if (Math.max(y(a), y(b), y(c), y(d)) < under) continue;
      coarse.push(a, c, b, b, c, d);
    }
    const reflGeo = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'surfUv']) reflGeo.setAttribute(name, geometry.getAttribute(name));
    reflGeo.setIndex(coarse); reflGeo.boundingSphere = geometry.boundingSphere!.clone();
    const reflection = new THREE.Mesh(reflGeo, snow);
    reflection.name = 'isla-reflejo'; reflection.visible = false;
    this.group.add(reflection);

    // ── Agua ────────────────────────────────────────────────────────────────
    // La del visor de bases (reflejo planar, oleaje sedoso, color por distancia a la costa, espuma), a escala de isla.
    this.ocean = createOcean({ radius: 125, mirrorSwap: { hide: [ground], show: [reflection] as THREE.Object3D[] }, sun: new THREE.Vector3(...SUN_DIRECTION), mobile: !!opts.mobile, maxAniso: opts.maxAniso ?? 1,
      scale: WATER_SCALE, shore: oceanShore(maps.sdf, t.n, t.half, WATER_SCALE) });
    this.ocean.mesh.position.y = t.seaY;
    this.group.add(this.ocean.mesh);
    // Icebergs del visor alrededor de la isla (decorativos, ubicación fija por isla).
    const coast = coastDistanceSampler(maps.sdf, t.n, t.half);
    this.icebergs = createIslandIcebergs(t, u as unknown as Record<string, THREE.IUniform>, (x, z) => Math.max(-coast(x, z), 0));
    this.group.add(this.icebergs.group);
    this.timings = { terrainMs, mapsMs, materialMs, meshMs: performance.now() - start - materialMs };
  }

  /** Altura del suelo con las huellas actuales (m). */
  height(x: number, z: number) { return this.terrain.sample(x, z) - this.footprints.sample(x, z); }

  private deformed(col: number, row: number) {
    const n = this.terrain.n, i = Math.min(n - 1, Math.max(0, row)) * n + Math.min(n - 1, Math.max(0, col));
    return this.terrain.heights[i] - this.footprints.depths[i];
  }

  private writeNormal(target: Float32Array, v: number, col: number, row: number) {
    const e = this.terrain.cell, nx = -(this.deformed(col + 1, row) - this.deformed(col - 1, row)) / (2 * e), nz = -(this.deformed(col, row + 1) - this.deformed(col, row - 1)) / (2 * e), len = Math.hypot(nx, 1, nz);
    target[v * 3] = nx / len; target[v * 3 + 1] = 1 / len; target[v * 3 + 2] = nz / len;
  }

  /** Vuelca a la malla y a la textura una región de celdas de huellas (con 2 de margen para las normales). */
  applyRegion(dirty: Region) {
    const started = performance.now(), t = this.terrain, n = t.n, s = this.stride, m = this.vertsPerRow;
    const x0 = Math.max(0, dirty.x0 - 2), x1 = Math.min(n - 1, dirty.x1 + 2), z0 = Math.max(0, dirty.z0 - 2), z1 = Math.min(n - 1, dirty.z1 + 2);
    const positions = this.position.array as Float32Array, normals = this.normal.array as Float32Array;
    const vc0 = Math.ceil(x0 / s), vc1 = Math.floor(x1 / s), vr0 = Math.ceil(z0 / s), vr1 = Math.floor(z1 / s);
    if (vc1 >= vc0) for (let vr = vr0; vr <= vr1; vr++) {
      for (let vc = vc0; vc <= vc1; vc++) {
        const v = vr * m + vc;
        positions[v * 3 + 1] = this.deformed(vc * s, vr * s);
        this.writeNormal(normals, v, vc * s, vr * s);
      }
      this.position.addUpdateRange((vr * m + vc0) * 3, (vc1 - vc0 + 1) * 3);
      this.normal.addUpdateRange((vr * m + vc0) * 3, (vc1 - vc0 + 1) * 3);
    }
    if (vc1 >= vc0 && vr1 >= vr0) { this.position.needsUpdate = true; this.normal.needsUpdate = true; }
    for (let row = z0; row <= z1; row++) for (let col = x0; col <= x1; col++) writeSurfaceTexel(t, this.surface, this.footprints.depths, this.footprints.maxDepth, col, row);
    // La subida a la GPU se hace en flush(): una sola región por cuadro, con sus mipmaps.
    const p = this.pending;
    this.pending = p ? { x0: Math.min(p.x0, x0), x1: Math.max(p.x1, x1), z0: Math.min(p.z0, z0), z1: Math.max(p.z1, z1) } : { x0, x1, z0, z1 };
    this.cpuMs += performance.now() - started;
  }

  /**
   * Sube a la GPU solo la región modificada, en todos los niveles de mipmap. Con `needsUpdate`, three.js
   * regeneraba los mipmaps de la textura entera (1281², ~6,5 MB) en cada pisada: un tirón por paso.
   * Los niveles se recalculan en CPU (promedio 2 × 2, como generateMipmap) solo dentro de la región.
   */
  flush(renderer: THREE.WebGLRenderer) {
    const region = this.pending;
    if (!region) return;
    const props = renderer.properties.get(this.surfaceTexture) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) { this.surfaceTexture.needsUpdate = true; this.pending = null; return; } // aún sin subir
    const started = performance.now();
    this.pending = null;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    let { x0, x1, z0, z1 } = region;
    for (let level = 0; level < this.mips.length; level++) {
      const size = this.mipSizes[level], data = this.mips[level];
      if (level > 0) {
        // Región del nivel: la mitad de la anterior; texeles = promedio de los 2 × 2 de abajo.
        x0 = x0 >> 1; z0 = z0 >> 1; x1 = Math.min(size - 1, x1 >> 1); z1 = Math.min(size - 1, z1 >> 1);
        const below = this.mips[level - 1], bs = this.mipSizes[level - 1];
        for (let r = z0; r <= z1; r++) for (let c = x0; c <= x1; c++) {
          const r0 = Math.min(bs - 1, 2 * r), r1 = Math.min(bs - 1, 2 * r + 1), c0 = Math.min(bs - 1, 2 * c), c1 = Math.min(bs - 1, 2 * c + 1);
          for (let k = 0; k < 4; k++) data[(r * size + c) * 4 + k] = (below[(r0 * bs + c0) * 4 + k] + below[(r0 * bs + c1) * 4 + k] + below[(r1 * bs + c0) * 4 + k] + below[(r1 * bs + c1) * 4 + k] + 2) >> 2;
        }
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, size);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, z0);
      gl.texSubImage2D(gl.TEXTURE_2D, level, x0, z0, x1 - x0 + 1, z1 - z0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    this.cpuMs += performance.now() - started;
  }

  /** Desvanece huellas y refresca solo los bloques que cambiaron. Devuelve false si no queda ninguna. */
  fade(dt: number) {
    const started = performance.now();
    const dirty = this.footprints.fade(dt);
    this.cpuMs += performance.now() - started;
    if (dirty) {
      const tile = SnowFootprints.FADE_TILE, perRow = Math.ceil(this.terrain.n / tile);
      for (const id of this.footprints.fadedTiles) {
        const tx = id % perRow, tz = Math.floor(id / perRow);
        this.applyRegion({ x0: tx * tile, x1: tx * tile + tile - 1, z0: tz * tile, z1: tz * tile + tile - 1 });
      }
    }
    return this.footprints.active.size > 0;
  }

  /** Borra todas las huellas: solo se reescriben los bloques que tenían alguna. */
  clear() {
    const tile = SnowFootprints.FADE_TILE, n = this.terrain.n, perRow = Math.ceil(n / tile), tiles = new Set<number>();
    for (const i of this.footprints.active) tiles.add(Math.floor(Math.floor(i / n) / tile) * perRow + Math.floor((i % n) / tile));
    this.footprints.clear();
    for (const id of tiles) {
      const tx = id % perRow, tz = Math.floor(id / perRow);
      this.applyRegion({ x0: tx * tile, x1: tx * tile + tile - 1, z0: tz * tile, z1: tz * tile + tile - 1 });
    }
  }

  update(elapsed: number) { this.uniforms.uTime.value = elapsed; this.ocean.time(elapsed); this.icebergs.animate(elapsed); }
}
