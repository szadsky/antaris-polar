import type { BaseRecord } from './base-information';
import continent from '../../terreno-bases/public/map/antartida.json';
import peninsula from '../../terreno-bases/public/map/peninsula.json';
import { projectLocation } from './location-projection';

const NS = 'http://www.w3.org/2000/svg';
function svgNode(tag: string, attrs: Record<string, string>) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** A static geographic locator; never uses the terrain's COMNAP origin. */
export function createBaseLocation(base: BaseRecord) {
  const section = document.createElement('section'); section.className = 'base-location';
  const heading = document.createElement('h2'); heading.textContent = 'Ubicación';
  section.append(heading);
  const figure = document.createElement('figure');
  const [east, north] = projectLocation(base.coordenadas.lat, base.coordenadas.lon);
  // Existing ADD paths are in km with SVG Y inverted. The regional paths use 100 m units.
  const x = east / 1000, y = -north / 1000;
  const continental = base.id === 'belgrano-ii';
  const widths: Record<string, number> = { orcadas: 180, carlini: 150, camara: 100, decepcion: 65, 'san-martin': 350 };
  const width = continental ? 6800 : widths[base.id] ?? 300;
  const height = width * .8;
  const viewBox = continental ? '-3400 -3000 6800 5440' : `${x - width / 2} ${y - height / 2} ${width} ${height}`;
  const map = svgNode('svg', { viewBox, role: 'img', 'aria-label': `Ubicación de ${base.nombre}. ${base.coordenadas.texto}`, class: 'base-location__map' });
  const regional = !continental && base.id !== 'orcadas';
  const coast = regional ? peninsula.costa : continent.costa;
  const land = svgNode('g', { transform: regional ? 'scale(0.1)' : 'scale(1)', fill: 'currentColor', 'fill-rule': 'evenodd' });
  for (const d of [coast.tierra, coast.hielo]) land.append(svgNode('path', { d }));
  map.append(land);
  // The pin's tip, rather than its centre, is exactly at the projected coordinate.
  const pin = svgNode('g', { transform: `translate(${x} ${y}) scale(${width / 340})`, class: 'base-location__pin' });
  pin.append(svgNode('path', { d: 'M0 0C-3-5-9-10-9-17a9 9 0 1 1 18 0C9-10 3-5 0 0Z', fill: 'var(--accent)', stroke: '#fff', 'stroke-width': '2' }));
  pin.append(svgNode('circle', { cx: '0', cy: '-17', r: '3', fill: '#fff' }));
  map.append(pin);
  const caption = document.createElement('figcaption');
  const name = document.createElement('strong'); name.textContent = base.nombre;
  const coordinates = document.createElement('span'); coordinates.textContent = base.coordenadas.texto;
  caption.append(name, coordinates); figure.append(map, caption); section.append(figure);
  const credit = document.createElement('p'); credit.className = 'base-location__credit';
  const refs = [
    ['Coordenadas: IGN', 'https://www.ign.gob.ar/NuestrasActividades/Geografia/DatosArgentina/BasesAntartida'],
    ['Costa: SCAR ADD / BAS, 2025', 'https://doi.org/qc9x'],
    ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
  ];
  refs.forEach(([label, href], i) => { if (i) credit.append(' · '); const a = document.createElement('a'); a.textContent = label; a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; credit.append(a); });
  credit.append(' · EPSG:3031 · Costa simplificada'); section.append(credit);
  return section;
}
