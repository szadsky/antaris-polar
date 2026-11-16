/**
 * Controles táctiles del menú del pingüino (celular y tableta):
 *  - joystick flotante: se apoya el pulgar en cualquier lugar de la mitad izquierda de abajo y el joystick nace ahí;
 *    la dirección es relativa a la cámara (como W A S D) y, llevándolo al borde, corre (como Shift);
 *  - botón "Saltar" (toque) y botón "Deslizar" (mantener, como E), abajo a la derecha;
 *  - el resto de la pantalla sigue siendo la cámara: un dedo gira, dos dedos acercan o alejan (OrbitControls).
 * Solo aparece con pantalla táctil (puntero grueso o el primer toque). Los botones son grandes (≥ 64 px) y con texto.
 */
export interface TouchInput { x: number; z: number; run: boolean; slide: boolean }

const RADIUS = 56;      // px: recorrido del joystick
const DEAD = 0.12;      // fracción del recorrido sin efecto
const RUN_AT = 0.85;    // fracción a partir de la cual corre

export function setupTouchControls(o: { onJump: () => void; onFirstTouch: () => void }) {
  const input: TouchInput = { x: 0, z: 0, run: false, slide: false };
  const root = document.createElement('div');
  root.className = 'touch-controls'; root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="touch-stick" role="group" aria-label="Joystick: arrastrá para caminar; hasta el borde para correr">
      <div class="touch-stick__base"><div class="touch-stick__knob"></div></div>
      <span class="touch-stick__hint">Arrastrá para caminar</span>
    </div>
    <div class="touch-buttons">
      <button type="button" class="touch-btn touch-btn--slide" aria-label="Deslizar (mantener)">Deslizar</button>
      <button type="button" class="touch-btn touch-btn--jump" aria-label="Saltar">Saltar</button>
    </div>`;
  document.body.append(root);
  const zone = root.querySelector<HTMLElement>('.touch-stick')!, base = root.querySelector<HTMLElement>('.touch-stick__base')!, knob = root.querySelector<HTMLElement>('.touch-stick__knob')!;
  const jump = root.querySelector<HTMLButtonElement>('.touch-btn--jump')!, slide = root.querySelector<HTMLButtonElement>('.touch-btn--slide')!;

  let first = true;
  const touched = () => { if (first) { first = false; o.onFirstTouch(); } enable(); };
  const enable = () => document.body.classList.add('touch');
  if (matchMedia('(pointer: coarse)').matches) enable();
  window.addEventListener('touchstart', touched, { passive: true, once: true });

  // Joystick flotante
  let stickId = -1, cx = 0, cy = 0;
  const rest = () => { base.style.removeProperty('left'); base.style.removeProperty('top'); zone.classList.remove('active'); knob.style.transform = ''; input.x = input.z = 0; input.run = false; };
  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== -1) return;
    touched(); stickId = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch { /* puntero sin captura */ }
    const r = zone.getBoundingClientRect();
    cx = e.clientX; cy = e.clientY;
    base.style.left = `${cx - r.left}px`; base.style.top = `${cy - r.top}px`;
    zone.classList.add('active'); e.preventDefault();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy), k = len > RADIUS ? RADIUS / len : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const m = Math.min(1, len / RADIUS);
    if (m < DEAD) { input.x = input.z = 0; input.run = false; return; }
    input.x = dx / RADIUS; input.z = -dy / RADIUS; input.run = m >= RUN_AT;
  });
  const endStick = (e: PointerEvent) => { if (e.pointerId !== stickId) return; stickId = -1; rest(); };
  zone.addEventListener('pointerup', endStick); zone.addEventListener('pointercancel', endStick);

  // Saltar (toque) y deslizar (mantener)
  jump.addEventListener('pointerdown', (e) => { touched(); e.preventDefault(); jump.classList.add('pressed'); o.onJump(); });
  const unJump = () => jump.classList.remove('pressed');
  jump.addEventListener('pointerup', unJump); jump.addEventListener('pointercancel', unJump); jump.addEventListener('pointerleave', unJump);
  slide.addEventListener('pointerdown', (e) => { touched(); e.preventDefault(); try { slide.setPointerCapture(e.pointerId); } catch { /* puntero sin captura */ } slide.classList.add('pressed'); input.slide = true; });
  const unSlide = () => { slide.classList.remove('pressed'); input.slide = false; };
  slide.addEventListener('pointerup', unSlide); slide.addEventListener('pointercancel', unSlide);
  // Sin menú contextual ni selección al mantener apretado.
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  // Al perder el foco (otra app, llamada), se sueltan los controles.
  const release = () => { stickId = -1; rest(); unSlide(); };
  window.addEventListener('blur', release); document.addEventListener('visibilitychange', release);

  return { input, release };
}
