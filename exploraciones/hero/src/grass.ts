import * as THREE from 'three';
import { CAM_H, onPlane } from './camara';

/**
 * Pasto seco (reconstrucción artística): matas recortadas de la capa 07 pintada (solo sus píxeles de pasto, ver
 * scripts/preparar-assets.mjs §6), en tiras de 16 px paradas sobre la loma a la profundidad de su pie. Desde la
 * cámara del hero cada píxel cae donde estaba en la referencia; al moverla, cada tira se desplaza con la loma.
 * El material de nieve del visor no tiene pasto: esto es un agregado del hero.
 */
interface GrassSprite { x: number; y: number; w: number; h: number; ax: number; ay: number; pies: number[] }

export async function createGrass(base: string, groundAt: (x: number, y: number) => THREE.Vector3) {
  const [tex, info] = await Promise.all([
    new THREE.TextureLoader().loadAsync(base + 'pasto.webp'),
    fetch(base + 'pasto.json').then((r) => r.json() as Promise<{ atlas: [number, number]; tira: number; sprites: GrassSprite[] }>),
  ]);
  tex.colorSpace = THREE.SRGBColorSpace;
  const [aw, ah] = info.atlas, S = info.tira, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const s of info.sprites) s.pies.forEach((pie, k) => {
    const x0 = s.x + k * S, x1 = Math.min(s.x + s.w, x0 + S);
    // 4 cm delante de la nieve para no pelear con ella en la profundidad
    const dist = -groundAt((x0 + x1) / 2, pie).z - 0.04, v = pos.length / 3;
    for (const [x, y] of [[x0, s.y], [x1, s.y], [x0, s.y + s.h], [x1, s.y + s.h]]) {
      const p = onPlane(x, y, dist);
      pos.push(p[0], p[1] + CAM_H, p[2]);
      uv.push((s.ax + x - s.x) / aw, 1 - (s.ay + y - s.y) / ah);
    }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  mesh.name = 'pasto'; mesh.frustumCulled = false; mesh.renderOrder = 2;
  return { mesh, strips: idx.length / 6, dispose() { geo.dispose(); (mesh.material as THREE.Material).dispose(); tex.dispose(); } };
}
