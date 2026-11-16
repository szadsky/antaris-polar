/**
 * Navegación entre los sitios de Antaris Polar (markup en index.html).
 *
 * Los enlaces `[data-sitio]` usan las rutas de la compilación del sitio (scripts/assemble-site.mjs): el visor en `/`,
 * el laboratorio en `/laboratorio/pinguino/`. En desarrollo esas rutas no existen en este servidor (:3420), así que se
 * apuntan a `npm run preview` del sitio armado (http://127.0.0.1:3410). Se puede cambiar con VITE_SITIO.
 */
const base: string = import.meta.env.VITE_SITIO ?? (import.meta.env.DEV ? 'http://127.0.0.1:3410' : '');
if (base) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-sitio]')) a.href = base + a.getAttribute('href');
}

// Menú desplegable en pantallas angostas: botón con aria-expanded, se cierra con Escape, al tocar afuera o al elegir.
const nav = document.querySelector<HTMLElement>('.site-nav');
const toggle = nav?.querySelector<HTMLButtonElement>('.site-nav__toggle');
if (nav && toggle) {
  const setOpen = (open: boolean) => { nav.classList.toggle('is-open', open); toggle.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); toggle.focus(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!nav.contains(e.target as Node)) setOpen(false); });
  nav.addEventListener('click', (e) => { if ((e.target as Element).closest('a')) setOpen(false); });
}
