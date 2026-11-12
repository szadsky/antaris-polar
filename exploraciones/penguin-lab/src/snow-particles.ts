import * as THREE from 'three';

/**
 * Granitos de nieve que saltan al pisar y al deslizar sobre nieve blanda. Un solo objeto THREE.Points
 * (una llamada de dibujo) con un búfer circular de `capacity` partículas; la física (impulso, gravedad,
 * arrastre del aire y choque con el suelo) se calcula en CPU, unos microsegundos por cuadro.
 */
export interface SnowBurst {
 /** Dirección horizontal del movimiento del pingüino (la nieve sale hacia atrás y a los costados). */
 dirX?: number; dirZ?: number;
 /** Velocidad horizontal (m/s), vertical (m/s), tamaño (m) y vida (s): [mín, máx]. */
 speed?: [number, number]; up?: [number, number]; size?: [number, number]; life?: [number, number];
 /** 0: en todas direcciones; 1: casi solo hacia atrás y a los costados. */
 back?: number;
}

const VERTEX = `
attribute float size;
attribute float alpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(-mv.z, 0.05);
  vAlpha = alpha;
}`;
const FRAGMENT = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = vAlpha * smoothstep(0.5, 0.15, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SnowParticles {
 readonly points: THREE.Points;
 readonly capacity: number;
 private readonly position: Float32Array;
 private readonly velocity: Float32Array;
 private readonly size: Float32Array;
 private readonly alpha: Float32Array;
 private readonly age: Float32Array;
 private readonly life: Float32Array;
 private readonly baseSize: Float32Array;
 private next = 0;
 /** Partículas vivas (para medir y para no actualizar de más). */
 alive = 0;
 private readonly material: THREE.ShaderMaterial;

 constructor(capacity = 600) {
  this.capacity = capacity;
  this.position = new Float32Array(capacity * 3).fill(0);
  this.velocity = new Float32Array(capacity * 3);
  this.size = new Float32Array(capacity);
  this.alpha = new Float32Array(capacity);
  this.age = new Float32Array(capacity).fill(1);
  this.life = new Float32Array(capacity).fill(1);
  this.baseSize = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
  // Siempre visibles cerca del pingüino: sin recorte por la caja (la caja cambia en cada cuadro).
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  this.material = new THREE.ShaderMaterial({
   uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color('#eef4f8') } },
   vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
  });
  this.points = new THREE.Points(geometry, this.material);
  this.points.frustumCulled = false;
  this.points.name = 'nieve-particulas';
 }

 /** Escala de tamaño en pantalla: alto del lienzo (px) / (2 · tan(fov/2)). Llamar al cambiar tamaño o fov. */
 setViewport(heightPx: number, fovDeg: number) { this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)); }

 emit(x: number, y: number, z: number, count: number, burst: SnowBurst = {}) {
  const [s0, s1] = burst.speed ?? [.3, .9], [u0, u1] = burst.up ?? [.6, 1.3], [z0, z1] = burst.size ?? [.022, .045], [l0, l1] = burst.life ?? [.45, .85];
  const dirLen = Math.hypot(burst.dirX ?? 0, burst.dirZ ?? 0), back = dirLen > 0 ? burst.back ?? .6 : 0;
  const bx = dirLen > 0 ? -(burst.dirX ?? 0) / dirLen : 0, bz = dirLen > 0 ? -(burst.dirZ ?? 0) / dirLen : 0;
  for (let k = 0; k < count; k++) {
   const i = this.next; this.next = (this.next + 1) % this.capacity;
   // Dirección: al azar, inclinada hacia atrás del movimiento según `back`.
   const a = Math.random() * Math.PI * 2;
   let hx = Math.cos(a) * (1 - back) + bx * back, hz = Math.sin(a) * (1 - back) + bz * back;
   const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
   const sp = s0 + (s1 - s0) * Math.random();
   this.position[i * 3] = x + hx * .05; this.position[i * 3 + 1] = y + .02; this.position[i * 3 + 2] = z + hz * .05;
   this.velocity[i * 3] = hx * sp; this.velocity[i * 3 + 1] = u0 + (u1 - u0) * Math.random(); this.velocity[i * 3 + 2] = hz * sp;
   this.baseSize[i] = z0 + (z1 - z0) * Math.random();
   this.age[i] = 0; this.life[i] = l0 + (l1 - l0) * Math.random();
  }
 }

 /** Avanza la simulación. `ground(x, z)`: altura del suelo; la partícula que lo toca se apaga. */
 update(dt: number, ground?: (x: number, z: number) => number) {
  const g = 5.5, drag = Math.exp(-2.2 * dt); // nieve liviana: cae más lento que una piedra y frena en el aire
  let alive = 0;
  for (let i = 0; i < this.capacity; i++) {
   if (this.age[i] >= this.life[i]) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
   this.age[i] += dt;
   const o = i * 3;
   this.velocity[o] *= drag; this.velocity[o + 2] *= drag; this.velocity[o + 1] = this.velocity[o + 1] * drag - g * dt;
   this.position[o] += this.velocity[o] * dt; this.position[o + 1] += this.velocity[o + 1] * dt; this.position[o + 2] += this.velocity[o + 2] * dt;
   if (ground && this.velocity[o + 1] < 0 && this.position[o + 1] < ground(this.position[o], this.position[o + 2])) this.age[i] = Math.max(this.age[i], this.life[i] - .08);
   const t = this.age[i] / this.life[i];
   // Aparece en 40 ms y se desvanece hacia el final; se achica un poco al caer.
   this.alpha[i] = Math.max(0, Math.min(1, this.age[i] / .04) * (1 - t * t) * .9);
   this.size[i] = this.baseSize[i] * (1 - .35 * t);
   alive++;
  }
  const wasAlive = this.alive; this.alive = alive;
  if (alive === 0 && wasAlive === 0) return; // nada que subir a la GPU
  const geo = this.points.geometry;
  (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (geo.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
  (geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
 }

 dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}
