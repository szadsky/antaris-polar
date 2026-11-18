import { createBaseLocation } from './base-location';
import { SelectControl } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';
import { conControles } from '../../../compartido/modo';
export interface BaseRecord {
  id: string; nombre: string; permanente: boolean; ubicacion: string; descripcion: string;
  inauguracion: string; coordenadas: { lat: number; lon: number; texto: string };
  mapa: { lat: number; lon: number; projected: [number, number] };
  historia?: string; fuentes: { nombre: string; url: string }[];
}
let catalogue: Promise<{ bases: BaseRecord[] }> | undefined;
export function loadBases(): Promise<{ bases: BaseRecord[] }> {
  return catalogue ??= fetch(import.meta.env.BASE_URL + 'terreno/index.json').then(r => {
    if (!r.ok) throw new Error('No se pudo cargar el listado de bases.');
    return r.json();
  });
}
export function selectedBase(bases: BaseRecord[]) {
  return bases.find(b => b.id === new URLSearchParams(location.search).get('base')) ?? bases.find(b => b.id === 'brown')!;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node;
}
export function showBaseCard(base: BaseRecord[], id: string, focus = false) {
  const b = base.find(b => b.id === id); const host = document.getElementById('base-card');
  if (!b || !host) return;
  host.dataset.baseId = b.id;
  const title = el('h1', b.nombre); title.id = 'base-card-title'; title.tabIndex = -1;
  const badge = el('span', b.permanente ? 'Permanente' : 'Temporaria', 'base-card__badge');
  const location = el('p', b.ubicacion, 'base-card__location');
  const description = el('p', b.descripcion, 'base-card__description');
  const facts = el('dl', undefined, 'base-card__facts');
  const date = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(b.inauguracion + 'T12:00:00Z'));
  for (const [label, value] of [['Inauguración', date], ['Coordenadas · IGN', b.coordenadas.texto]]) {
    const cell = el('div'); cell.append(el('dt', label), el('dd', value)); facts.append(cell);
  }
  host.replaceChildren(title, badge, location, description, facts, createBaseLocation(b));
  if (b.historia) { const more = el('details', undefined, 'base-card__history'); more.append(el('summary', 'Historia y actividades'), el('p', b.historia)); host.append(more); }
  const sources = el('footer', undefined, 'base-card__sources'); sources.append(el('h2', 'Fuentes'));
  for (const ref of b.fuentes) { const link = el('a', ref.nombre); link.href = ref.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link); }
  host.append(sources);
  if (focus) { host.scrollIntoView({ block: 'nearest', behavior: 'auto' }); title.focus({ preventScroll: true }); }
}
export async function mountBaseInformation() {
  const { bases } = await loadBases(); const selected = selectedBase(bases);
  const select = document.getElementById('base') as HTMLSelectElement;
  select.replaceChildren(...bases.map(b => new Option(b.nombre.replace(/^Base /, ''), b.id, false, b.id === selected.id)));
  SelectControl(document.getElementById('dial-base')!, {
    label: 'Base', value: select.value,
    options: Array.from(select.options, option => ({ value: option.value, label: option.text })),
    onChange(value: string) { select.value = value; select.dispatchEvent(new Event('change')); },
  });
  showBaseCard(bases, selected.id);
  select.addEventListener('change', () => {
    showBaseCard(bases, select.value);
    const url = new URL(location.href); url.searchParams.set('base', select.value); location.href = url.href;
  });
  const pin = document.getElementById('pin')!;
  pin.dataset.baseId = selected.id;
  if (!conControles()) {
    pin.setAttribute('role', 'button'); pin.tabIndex = 0;
    pin.setAttribute('aria-label', 'Ver información de ' + selected.nombre);
    const open = () => showBaseCard(bases, pin.dataset.baseId!, true);
    pin.addEventListener('click', open);
    pin.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  }
}
