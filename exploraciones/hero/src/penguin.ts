import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyKingPenguinColors } from './king-penguin-colors';

/**
 * Pingüino del laboratorio (penguin-custom-smooth.glb, Polyfork, CC BY 4.0, con los colores de pingüino rey de
 * king-penguin-colors.ts), de espaldas a la cámara, con la animación de reposo y la cabeza girada a la derecha
 * como en la referencia. 0,95 m de alto (pingüino rey adulto: ~0,9–1 m).
 */
export const PENGUIN_HEIGHT_M = 0.95;

export async function createPenguin(url: string) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  applyKingPenguinColors(model);
  const box = new THREE.Box3().setFromObject(model), extent = box.getSize(new THREE.Vector3());
  model.scale.setScalar(PENGUIN_HEIGHT_M / extent.y);
  box.setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    // relleno azulado mínimo: a contraluz del sol bajo el plumaje oscuro quedaba casi negro (la referencia lo ve gris)
    if (o.material instanceof THREE.MeshStandardMaterial) o.material.emissive.setRGB(0.03, 0.036, 0.05);
  });
  const group = new THREE.Group();
  group.name = 'pinguino';
  group.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const idle = gltf.animations.find((c) => c.name.toLowerCase() === 'idle');
  if (idle) mixer.clipAction(idle).play();
  const head = model.getObjectByName('Head');
  const parentQ = new THREE.Quaternion(), turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let headYaw = 0, lastApplied: THREE.Quaternion | null = null;
  const preTurn = new THREE.Quaternion();
  // Aletas pegadas al cuerpo como en la referencia (el reposo del modelo las abre): giro local en z, sin acumular.
  const WING_CLOSE = 0.4;
  const wings = (['LeftWing', 'RightWing'] as const).map((name, k) => ({ bone: model.getObjectByName(name), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), k === 0 ? -WING_CLOSE : WING_CLOSE), pre: new THREE.Quaternion(), last: null as THREE.Quaternion | null }));
  return {
    group, mixer,
    /** Giro de la cabeza alrededor de la vertical del mundo (rad, negativo = hacia la derecha de la cámara). */
    set headYaw(v: number) { headYaw = v; },
    update(dt: number) {
      mixer.update(dt);
      for (const w of wings) {
        if (!w.bone) continue;
        if (w.last && w.bone.quaternion.equals(w.last)) w.bone.quaternion.copy(w.pre);
        w.pre.copy(w.bone.quaternion); w.bone.quaternion.multiply(w.q); w.last = w.bone.quaternion.clone();
      }
      // Si la animación no escribió la cabeza este cuadro, se parte de la pose sin girar (el giro no se acumula).
      if (head && lastApplied && head.quaternion.equals(lastApplied)) head.quaternion.copy(preTurn);
      if (head?.parent && headYaw) {
        preTurn.copy(head.quaternion);
        group.updateMatrixWorld(true);
        head.parent.getWorldQuaternion(parentQ);
        turn.setFromAxisAngle(up, headYaw);
        // giro en el espacio del mundo llevado al espacio del hueso padre
        const local = parentQ.clone().invert().multiply(turn).multiply(parentQ);
        head.quaternion.premultiply(local);
        lastApplied = head.quaternion.clone();
      }
    },
    dispose() { mixer.stopAllAction(); model.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); },
  };
}
