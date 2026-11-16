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

export type SitioActual = 'inicio' | 'descubrir' | 'laboratorio' | 'islas';

export const RUTAS: Record<SitioActual, string> = {
  inicio: '/',
  descubrir: '/descubrir/',
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
  const origen: string = base ?? import.meta.env.VITE_SITIO ?? (import.meta.env.DEV ? 'http://127.0.0.1:3410' : '');
  document.querySelector('.site-nav-bar')?.remove();

  const href = (k: SitioActual) => origen + RUTAS[k];
  const actualAttr = (k: SitioActual) => (k === actual ? ' aria-current="page"' : '');
  const sep = `<img class="site-nav__sep" src="${separador}" width="1" height="16" alt="">`;
  const pronto = (texto: string) =>
    `<li>${sep}<span class="site-nav__pronto" title="Próximamente">${texto}<span class="site-nav__aviso"> (próximamente)</span></span></li>`;
  const enLaboratorio = actual === 'laboratorio' || actual === 'islas';

  // div y no <header>: algunos sitios tienen reglas sobre `header` que no deben alcanzar a la barra.
  const bar = document.createElement('div');
  bar.className = 'site-nav-bar';
  bar.innerHTML = `
    <a class="site-nav__brand" href="${href('inicio')}"${actualAttr('inicio')}>AntarisPolar</a>
    <nav class="site-nav" aria-label="Sitios de Antaris Polar">
      <button class="site-nav__toggle" type="button" aria-expanded="false" aria-controls="site-nav-lista">Menú</button>
      <ul id="site-nav-lista" class="site-nav__list">
        <li><a href="${href('descubrir')}"${actualAttr('descubrir')}>Descubrir</a></li>
        <li class="site-nav__grupo">${sep}<button class="site-nav__sub-toggle" type="button" aria-expanded="false"
          aria-controls="site-nav-lab"${enLaboratorio ? ' data-actual' : ''}>Laboratorio</button>
          <ul id="site-nav-lab" class="site-nav__sub">
            <li><a href="${href('laboratorio')}"${actualAttr('laboratorio')}>Pingüino y nieve</a></li>
            <li><a href="${href('islas')}"${actualAttr('islas')}>Islas de práctica</a></li>
          </ul>
        </li>
        ${pronto('Investigación')}${pronto('Quienes somos')}${pronto('Contacto')}
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

  // Desplegables: menú completo en pantallas angostas y submenú del laboratorio.
  const nav = bar.querySelector<HTMLElement>('.site-nav')!;
  const menuBtn = bar.querySelector<HTMLButtonElement>('.site-nav__toggle')!;
  const labBtn = bar.querySelector<HTMLButtonElement>('.site-nav__sub-toggle')!;
  const grupo = bar.querySelector<HTMLElement>('.site-nav__grupo')!;
  const setMenu = (open: boolean) => { nav.classList.toggle('is-open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  const setLab = (open: boolean) => { grupo.classList.toggle('is-open', open); labBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  labBtn.addEventListener('click', () => setLab(!grupo.classList.contains('is-open')));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (grupo.classList.contains('is-open')) { setLab(false); labBtn.focus(); }
    else if (nav.classList.contains('is-open')) { setMenu(false); menuBtn.focus(); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!bar.contains(e.target as Node)) { setMenu(false); setLab(false); }
  });
  bar.addEventListener('focusout', (e) => {
    if (!grupo.contains(e.relatedTarget as Node | null)) setLab(false);
  });
  return bar;
}
