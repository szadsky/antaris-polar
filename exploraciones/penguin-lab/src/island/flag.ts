import * as THREE from 'three';

/**
 * Bandera argentina que flamea (reemplaza a la bandera fija del modelo de la base). Tela de 24 × 14 segmentos con una
 * onda que crece desde el mástil (en GPU, en el vertex shader: sin costo de CPU por cuadro), normales de la onda para
 * la luz y la textura dibujada en un canvas: franjas celeste, blanca y celeste con el Sol de Mayo (simplificado).
 * En su propio espacio: x a lo largo de la tela desde el mástil, y hacia arriba (0 = borde de arriba), z la normal.
 */
export function flagTexture() {
  const W = 512, H = 320, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#74ACDF'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#FFFFFF'; g.fillRect(0, H / 3, W, H / 3);
  // Sol de Mayo: disco y 32 rayos alternados (rectos y más cortos), sin el rostro (simplificado a esta escala).
  const cx = W / 2, cy = H / 2, r = H * 0.075;
  g.fillStyle = '#F6B40E'; g.strokeStyle = '#85340A'; g.lineWidth = 1.2;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2, long = i % 2 === 0, R = r * (long ? 2.05 : 1.75), w = 0.07;
    g.beginPath();
    g.moveTo(cx + Math.cos(a - w) * r * 0.95, cy + Math.sin(a - w) * r * 0.95);
    g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.lineTo(cx + Math.cos(a + w) * r * 0.95, cy + Math.sin(a + w) * r * 0.95);
    g.closePath(); g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createFlag(length: number, height: number) {
  const geo = new THREE.PlaneGeometry(length, height, 24, 14);
  geo.translate(length / 2, -height / 2, 0); // borde del mástil en x = 0, borde de arriba en y = 0
  const uniforms = { uFlagTime: { value: 0 }, uFlagLen: { value: length } };
  const mat = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uFlagTime, uFlagLen;
// onda de la tela: crece desde el mástil (s = 0) hacia la punta (s = 1); dos ondas que viajan hacia afuera y una
// ondulación vertical leve. Devuelve el desplazamiento según la normal de la tela (z).
float flagWave(vec2 p) {
  float s = clamp(p.x / uFlagLen, 0.0, 1.0), k = 6.2831853 / uFlagLen;
  float a = uFlagLen * (0.05 + 0.14 * s) * s;
  return a * (sin(k * 1.3 * p.x - uFlagTime * 5.0 + p.y * 2.2) + 0.45 * sin(k * 2.7 * p.x - uFlagTime * 7.3 + 0.8));
}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{ float e = uFlagLen * 0.01;
  float dx = (flagWave(position.xy + vec2(e, 0.0)) - flagWave(position.xy - vec2(e, 0.0))) / (2.0 * e);
  float dy = (flagWave(position.xy + vec2(0.0, e)) - flagWave(position.xy - vec2(0.0, e))) / (2.0 * e);
  objectNormal = normalize(vec3(-dx, -dy, 1.0)); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.z += flagWave(position.xy);
transformed.x -= abs(flagWave(position.xy)) * 0.25 * clamp(position.x / uFlagLen, 0.0, 1.0); // la tela se acorta al ondular`);
  };
  mat.customProgramCacheKey = () => 'bandera-flamea';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'bandera argentina (flamea)';
  return { mesh, update(t: number) { uniforms.uFlagTime.value = t; }, dispose() { geo.dispose(); mat.map?.dispose(); mat.dispose(); } };
}
