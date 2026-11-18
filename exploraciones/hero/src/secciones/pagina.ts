import { mountSiteNav } from '../../../../compartido/navbar/navbar';
import '@fontsource/geist/300.css';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist-mono/500.css';
import './secciones.css';
import './mascara-modelo.css';
import { PAGINAS, type Pagina, type Tarjeta } from './contenido';
import { mountModelo } from './modelo';

/**
 * Páginas interiores Noticias e Investigaciones (Figma «Gamezone · david», nodo 2529:5): hero con el título a la
 * izquierda y el modelo 3D a la derecha, y secciones con carrusel de tarjetas. El HTML de cada página trae
 * <main data-pagina="noticias|investigaciones">; acá se arma el contenido a partir de src/secciones/contenido.ts.
 */
const main = document.querySelector<HTMLElement>('main[data-pagina]');
const id = (main?.dataset.pagina ?? 'noticias') as keyof typeof PAGINAS;
// Página actual en la barra común (compartido/navbar: 'noticias' | 'investigaciones').
mountSiteNav({ actual: id });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, txt?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function armar(main: HTMLElement, p: Pagina) {
  // Hero
  const hero = el('section', 'sec-hero');
  hero.setAttribute('aria-labelledby', 'sec-titulo');
  const texto = el('div', 'sec-hero__texto');
  const h1 = el('h1', 'sec-hero__titulo', p.titulo); h1.id = 'sec-titulo';
  texto.append(h1, el('p', 'sec-hero__bajada', p.bajada));
  if (p.ejemplo) texto.append(el('p', 'sec-aviso', 'Contenido de ejemplo: todavía no hay publicaciones verificadas cargadas.'));
  const modelo = el('div', 'sec-modelo');
  modelo.append(el('p', 'sec-modelo__estado', 'Escaneando modelo…'));
  const nota = el('p', 'sec-modelo__nota', `Modelo 3D decorativo (${p.modelo.nombre}): reconstrucción artística, no una estructura real.`);
  hero.append(texto, modelo, nota);
  main.append(hero);
  mountModelo(modelo, { url: p.modelo.url, giro: p.modelo.giro, elevacion: p.modelo.elevacion });

  // Secciones con carrusel
  p.secciones.forEach((s, i) => main.append(seccion(s.titulo, s.tarjetas, i)));
}

const CHEVRON_ATRAS = 'M14 17.6538L8.3463 12L14 6.3463L15.0538 7.4L10.4538 12L15.0538 16.6L14 17.6538Z';
const CHEVRON_ADELANTE = 'M12.9463 12L8.3463 7.4L9.4 6.3463L15.0538 12L9.4 17.6538L8.3463 16.6L12.9463 12Z';
const icono = (d: string) => `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;

function seccion(titulo: string, tarjetas: Tarjeta[], n: number) {
  const s = el('section', 'sec-carrusel');
  const hId = `sec-car-${n}`;
  s.setAttribute('aria-labelledby', hId);
  const cab = el('div', 'sec-carrusel__cab');
  const h2 = el('h2', 'sec-carrusel__titulo', titulo); h2.id = hId;
  const flechas = el('div', 'sec-flechas');
  const atras = el('button', 'sec-flecha'); atras.type = 'button'; atras.innerHTML = icono(CHEVRON_ATRAS); atras.setAttribute('aria-label', `Anteriores de ${titulo}`);
  const adelante = el('button', 'sec-flecha'); adelante.type = 'button'; adelante.innerHTML = icono(CHEVRON_ADELANTE); adelante.setAttribute('aria-label', `Siguientes de ${titulo}`);
  flechas.append(atras, el('span', 'sec-flechas__sep'), adelante);
  cab.append(h2, flechas);

  const pista = el('ul', 'sec-pista');
  pista.setAttribute('aria-label', titulo);
  for (const t of tarjetas) pista.append(tarjeta(t));
  const contador = el('p', 'sec-contador');
  contador.setAttribute('aria-live', 'polite');
  s.append(cab, pista, contador);

  const items = [...pista.children] as HTMLElement[];
  const pad = (v: number, d: number) => String(v).padStart(d, '0');
  const actualizar = () => {
    const r = pista.getBoundingClientRect();
    let primero = 0;
    items.forEach((it, i) => {
      const b = it.getBoundingClientRect();
      const completa = b.left >= r.left - 2 && b.right <= r.right + 2;
      it.classList.toggle('es-parcial', !completa);
      if (b.left < r.left + 4) primero = i;
    });
    contador.textContent = `${pad(Math.min(items.length, primero + 1), 2)}/${pad(items.length, 2)}`;
    atras.disabled = pista.scrollLeft <= 2;
    adelante.disabled = pista.scrollLeft + pista.clientWidth >= pista.scrollWidth - 2;
  };
  const paso = () => (items[1]?.getBoundingClientRect().left ?? 0) - (items[0]?.getBoundingClientRect().left ?? 0) || pista.clientWidth;
  atras.addEventListener('click', () => pista.scrollBy({ left: -paso(), behavior: 'smooth' }));
  adelante.addEventListener('click', () => pista.scrollBy({ left: paso(), behavior: 'smooth' }));
  pista.addEventListener('scroll', actualizar, { passive: true });
  new ResizeObserver(actualizar).observe(pista);
  requestAnimationFrame(actualizar);
  return s;
}

function tarjeta(t: Tarjeta) {
  const li = el('li', 'sec-tarjeta');
  const a = el(t.enlace ? 'a' : 'div', 'sec-tarjeta__marco') as HTMLElement;
  if (t.enlace) { (a as HTMLAnchorElement).href = t.enlace; (a as HTMLAnchorElement).rel = 'noopener'; }
  const img = el('img', 'sec-tarjeta__img');
  img.src = t.imagen; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.width = 706; img.height = 386;
  const cuerpo = el('div', 'sec-tarjeta__cuerpo');
  const meta = el('p', 'sec-tarjeta__meta');
  meta.append(el('span', '', t.autor), el('span', 'sec-tarjeta__sep'), el('span', '', t.fecha));
  const h3 = el('h3', 'sec-tarjeta__titulo', t.titulo);
  cuerpo.append(meta, h3, el('p', 'sec-tarjeta__bajada', t.bajada));
  // Figma: borde exterior blanco de 8 px (marco) y borde interior de 1 px con radio 16 (interior).
  const interior = el('div', 'sec-tarjeta__interior');
  interior.append(img, cuerpo);
  a.append(interior);
  li.append(a);
  return li;
}

// Al final: armar() usa las constantes de arriba (icono, CHEVRON_*), que recién existen después de declararse.
if (main) armar(main, PAGINAS[id]);
