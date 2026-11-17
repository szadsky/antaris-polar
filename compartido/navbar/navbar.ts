/**
 * Navegación común de los sitios de Antaris Polar (Figma «Gamezone · david», nodo 2597:1016).
 *
 * Uso, como primera importación del punto de entrada de cada sitio:
 *   import { mountSiteNav } from '../../../compartido/navbar/navbar';
 *   mountSiteNav({ actual: 'descubrir' });
 *
 * La barra se agrega al principio del <body> (posición fija arriba) y publica su alto en la variable CSS
 * `--site-nav-h` del <html>. Cada sitio suma esa variable a los `top` de lo que tiene anclado arriba, así nada queda
 * tapado; el canvas 3D sigue ocupando toda la pantalla.
 *
 * Rutas: las de la compilación del sitio (scripts/assemble-site.mjs). En desarrollo cada sitio corre en su propio
 * puerto, así que los enlaces apuntan al sitio armado (`npm run build && npm run preview`, http://127.0.0.1:3410) o a
 * VITE_SITIO.
 */
import './navbar.css';
import separador from './separador.svg';
import { aplicarModo } from '../modo';

export type SitioActual = 'inicio' | 'descubrir' | 'antarisplay' | 'laboratorio' | 'islas';

// Rutas del sitio armado. «laboratorio» e «islas» siguen publicados pero ya no están en la barra.
export const RUTAS: Record<SitioActual, string> = {
  inicio: '/',
  descubrir: '/descubrir/',
  antarisplay: '/antarisplay/',
  laboratorio: '/laboratorio/pinguino/',
  islas: '/pinguino-menu/',
};

export interface OpcionesNavbar {
  /** Sitio en el que está la página (se marca con aria-current). */
  actual: SitioActual;
  /** Origen de los enlaces; por defecto VITE_SITIO, en desarrollo http://127.0.0.1:3410 y en el build ''. */
  base?: string;
}

export function mountSiteNav({ actual, base }: OpcionesNavbar): HTMLElement {
  // Pública o exploración (compartido/modo.ts): todas las páginas montan la barra primero, así el modo queda puesto
  // antes de que cada sitio arme sus paneles.
  aplicarModo();
  const origen: string = base ?? import.meta.env.VITE_SITIO ?? (import.meta.env.DEV ? 'http://127.0.0.1:3410' : '');
  document.querySelector('.site-nav-bar')?.remove();

  const href = (k: SitioActual) => origen + RUTAS[k];
  const actualAttr = (k: SitioActual) => (k === actual ? ' aria-current="page"' : '');
  const sep = `<img class="site-nav__sep" src="${separador}" width="1" height="16" alt="">`;
  const pronto = (texto: string) =>
    `<li>${sep}<span class="site-nav__pronto" title="Próximamente">${texto}<span class="site-nav__aviso"> (próximamente)</span></span></li>`;
  const enlace = (k: SitioActual, texto: string, primero = false) =>
    `<li>${primero ? '' : sep}<a href="${href(k)}"${actualAttr(k)}>${texto}</a></li>`;

  // div y no <header>: algunos sitios tienen reglas sobre `header` que no deben alcanzar a la barra.
  // Ítems: Home (hero), AntarisPlay (trivia), Bases (visor), Noticias e Investigaciones (sin página todavía: se
  // agregan cuando estén sus diseños de Figma).
  const bar = document.createElement('div');
  bar.className = 'site-nav-bar';
  bar.innerHTML = `
    <a class="site-nav__brand" href="${href('inicio')}">AntarisPolar</a>
    <nav class="site-nav" aria-label="Sitios de Antaris Polar">
      <button class="site-nav__toggle" type="button" aria-expanded="false" aria-controls="site-nav-lista">Menú</button>
      <ul id="site-nav-lista" class="site-nav__list">
        ${enlace('inicio', 'Home', true)}${enlace('antarisplay', 'AntarisPlay')}${enlace('descubrir', 'Bases')}
        ${pronto('Noticias')}${pronto('Investigaciones')}
      </ul>
    </nav>`;
  // Primera en el orden de tabulación, salvo un enlace «Saltar al contenido» (a.skip), que va antes.
  const skip = document.body.querySelector(':scope > a.skip');
  if (skip) skip.after(bar); else document.body.prepend(bar);

  // Alto de la barra para el resto de la página.
  const root = document.documentElement;
  const publicarAlto = () => {
    const visible = getComputedStyle(bar).display !== 'none';
    root.style.setProperty('--site-nav-h', visible ? `${Math.ceil(bar.getBoundingClientRect().bottom)}px` : '0px');
  };
  publicarAlto();
  new ResizeObserver(publicarAlto).observe(bar);
  // En los modos de captura (clase en <body>) la barra se oculta y el alto vuelve a 0.
  new MutationObserver(publicarAlto).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Fondo de la barra apenas la página scrollea (ver .is-scrolled en navbar.css).
  const marcarScroll = () => bar.classList.toggle('is-scrolled', window.scrollY > 8);
  marcarScroll();
  addEventListener('scroll', marcarScroll, { passive: true });

  // Menú completo en pantallas angostas.
  const nav = bar.querySelector<HTMLElement>('.site-nav')!;
  const menuBtn = bar.querySelector<HTMLButtonElement>('.site-nav__toggle')!;
  const setMenu = (open: boolean) => { nav.classList.toggle('is-open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!bar.contains(e.target as Node)) setMenu(false);
  });
  return bar;
}
