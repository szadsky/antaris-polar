import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BasePose, IslandStructure, StructureSpec } from './island-base';

const STORAGE = (id: string, island: string) => `antaris-pinguino-${id}-${island}`;
const deg = (r: number) => Math.round((r * 180) / Math.PI);

/**
 * Lugar de una estructura: URL (?<id>X, ?<id>Z, ?<id>Giro en grados, ?<id>Alto; p. ej. ?baseX=…); si no, el guardado en
 * este navegador; si no, el fijo de la isla (StructureSpec.poses); si no, automático (solo la altura).
 */
export function savedPose(s: StructureSpec, island: string): Partial<BasePose> & { height: number } {
  const q = new URLSearchParams(location.search), num = (k: string) => (q.has(s.id + k) && Number.isFinite(Number(q.get(s.id + k))) ? Number(q.get(s.id + k)) : undefined);
  const giro = num('Giro'), height = num('Alto');
  const fromUrl = { x: num('X'), z: num('Z'), yaw: giro !== undefined ? (giro * Math.PI) / 180 : undefined };
  if (fromUrl.x !== undefined && fromUrl.z !== undefined) return { ...fromUrl, height: height ?? s.poses[island]?.height ?? s.height };
  try { const v = JSON.parse(localStorage.getItem(STORAGE(s.id, island)) ?? 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.z)) return { x: v.x, z: v.z, yaw: v.yaw ?? 0, height: height ?? v.height ?? s.height }; } catch { /* sin almacenamiento */ }
  const fixed = s.poses[island];
  return fixed ? { ...fixed, height: height ?? fixed.height } : { height: height ?? s.height };
}

/**
 * Modo "Mover estructuras": arrastrar una estructura sobre la isla (la cámara no gira mientras se arrastra; la que se
 * arrastró queda elegida), Z / X para girarla (con Shift, de a 5°), + / − para su tamaño. Los lugares se guardan en este
 * navegador y se pueden copiar (texto y enlace) para dejarlos fijos.
 */
export function setupBaseEditor(o: {
  items: { spec: StructureSpec; s: IslandStructure }[]; island: string; islandName: string; canvas: HTMLCanvasElement; camera: THREE.Camera;
  controls: OrbitControls; ground: THREE.Object3D; seaY: number; onChange: () => void; container: HTMLElement;
}) {
  const { items, canvas, camera, controls } = o;
  let sel = items[0];
  const button = document.createElement('button');
  button.id = 'move-base'; button.type = 'button'; button.setAttribute('aria-pressed', 'false'); button.textContent = 'Mover estructuras';
  o.container.prepend(button);
  const panel = document.createElement('section');
  panel.className = 'base-editor'; panel.hidden = true; panel.setAttribute('aria-label', 'Mover estructuras');
  panel.innerHTML = `<strong>Mover estructuras</strong>
    <p>Arrastrá una estructura sobre la isla. <kbd>Z</kbd> <kbd>X</kbd> girar · <kbd>+</kbd> <kbd>−</kbd> tamaño.</p>
    <div class="base-editor__row base-editor__pick" role="group" aria-label="Estructura elegida">${items.map((it, i) => `<button type="button" data-pick="${i}">${it.spec.name}</button>`).join('')}</div>
    <p class="base-editor__pose" aria-live="polite"></p>
    <div class="base-editor__row"><button type="button" data-a="left">↺ Girar</button><button type="button" data-a="right">↻ Girar</button><button type="button" data-a="smaller">− Tamaño</button><button type="button" data-a="bigger">+ Tamaño</button></div>
    <div class="base-editor__row"><button type="button" data-a="copy">Copiar ubicación</button><button type="button" data-a="auto">Volver al lugar fijo</button><button type="button" data-a="done">Listo</button></div>`;
  document.body.append(panel);
  const poseText = panel.querySelector('.base-editor__pose')!;
  let editing = false, dragging = false, pointerId = -1;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), offset = new THREE.Vector2(), seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -o.seaY), hitP = new THREE.Vector3();
  const line = (it: typeof sel) => { const p = it.s.pose(); return `${it.spec.name}: x ${p.x.toFixed(1)} · z ${p.z.toFixed(1)} m · giro ${deg(p.yaw)}° · alto ${p.height.toFixed(1)} m`; };
  const show = () => {
    poseText.textContent = line(sel);
    panel.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b, i) => b.setAttribute('aria-pressed', String(items[i] === sel)));
  };
  const save = (it = sel) => { try { localStorage.setItem(STORAGE(it.spec.id, o.island), JSON.stringify(it.s.pose())); } catch { /* sin almacenamiento */ } };
  const apply = (p: Partial<BasePose>) => { sel.s.setPose(p); show(); save(); o.onChange(); };
  const setEditing = (v: boolean) => {
    editing = v; panel.hidden = !v; button.setAttribute('aria-pressed', String(v)); button.textContent = v ? 'Moviendo estructuras…' : 'Mover estructuras';
    canvas.style.cursor = v ? 'grab' : ''; if (v) show();
  };
  button.onclick = () => setEditing(!editing);
  const aim = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  /** Punto del suelo bajo el puntero (la isla, o el plano del agua fuera de ella). */
  const groundPoint = () => { const h = ray.intersectObject(o.ground, false)[0]; if (h) return h.point; return ray.ray.intersectPlane(seaPlane, hitP); };
  canvas.addEventListener('pointerdown', (e) => {
    if (!editing || e.button !== 0) return;
    aim(e);
    let best: { it: typeof sel; d: number } | null = null;
    for (const it of items) { if (!it.s.group.visible) continue; const h = ray.intersectObject(it.s.model, true)[0]; if (h && (!best || h.distance < best.d)) best = { it, d: h.distance }; }
    if (!best) return; // fuera de las estructuras: la cámara gira como siempre
    const g = groundPoint(); if (!g) return;
    sel = best.it; show();
    const p = sel.s.pose(); offset.set(p.x - g.x, p.z - g.z);
    dragging = true; pointerId = e.pointerId; controls.enabled = false; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    aim(e); const g = groundPoint(); if (!g) return;
    sel.s.setPose({ x: g.x + offset.x, z: g.z + offset.y }); show(); o.onChange();
  });
  const end = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false; controls.enabled = true; canvas.style.cursor = 'grab'; save();
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  const turn = (d: number) => apply({ yaw: sel.s.pose().yaw + (d * Math.PI) / 180 });
  const grow = (d: number) => apply({ height: Math.min(20, Math.max(1, Math.round((sel.s.pose().height + d) * 2) / 2)) });
  window.addEventListener('keydown', (e) => {
    if (!editing || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input,textarea'))) return;
    const step = e.shiftKey ? 5 : 15;
    if (e.code === 'KeyZ') turn(step); else if (e.code === 'KeyX') turn(-step);
    else if (e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') grow(0.5);
    else if (e.key === '-' || e.code === 'NumpadSubtract' || e.code === 'Minus') grow(-0.5);
    else if (e.code === 'Escape') setEditing(false);
    else return;
    e.preventDefault();
  });
  panel.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.pick) { sel = items[Number(b.dataset.pick)]; show(); return; }
    const a = b.dataset.a;
    if (a === 'left') turn(15); else if (a === 'right') turn(-15); else if (a === 'smaller') grow(-0.5); else if (a === 'bigger') grow(0.5);
    else if (a === 'done') setEditing(false);
    else if (a === 'auto') {
      try { localStorage.removeItem(STORAGE(sel.spec.id, o.island)); } catch { /* */ }
      const u = new URL(location.href); for (const k of ['X', 'Z', 'Giro', 'Alto']) u.searchParams.delete(sel.spec.id + k); location.href = u.toString();
    } else if (a === 'copy') {
      const u = new URL(location.href); u.searchParams.set('terreno', o.island);
      for (const it of items) { const p = it.s.pose(); u.searchParams.set(it.spec.id + 'X', p.x.toFixed(2)); u.searchParams.set(it.spec.id + 'Z', p.z.toFixed(2)); u.searchParams.set(it.spec.id + 'Giro', String(deg(p.yaw))); u.searchParams.set(it.spec.id + 'Alto', p.height.toFixed(1)); }
      const text = `${o.islandName}\n${items.map(line).join('\n')}\n${u.toString()}`;
      try { await navigator.clipboard.writeText(text); poseText.textContent = 'Copiado: pegámelo en el chat.'; setTimeout(show, 2500); } catch { poseText.textContent = u.toString(); }
    }
  });
  return { get editing() { return editing; } };
}
