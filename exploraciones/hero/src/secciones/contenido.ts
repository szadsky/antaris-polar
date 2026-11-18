import investigaciones from './investigaciones.json';
import noticias from './noticias.json';

export interface Tarjeta {
  autor: string;
  fecha: string;
  titulo: string;
  bajada: string;
  imagen: string;
  enlace?: string;
  fechaISO?: string;
  categoria?: string;
  credito?: string;
  licencia?: string;
  licenciaUrl?: string;
}
export interface Seccion { titulo: string; tarjetas: Tarjeta[] }
export interface Pagina {
  titulo: string;
  bajada: string;
  modelo: { url: string; nombre: string; giro?: number; elevacion?: number };
  ejemplo: boolean;
  secciones: Seccion[];
  papers?: typeof investigaciones.papers;
}

const IMG = '/secciones/tarjeta-ejemplo.webp';
// Orden global por publicación; las secciones temáticas siguen la primera aparición.
const seccionesNoticias: Seccion[] = [];
const tarjetaNoticia = (n: typeof noticias.notas[number] | typeof investigaciones.noticias[number]): Tarjeta => ({
  autor: n.organismo + (n.idioma === 'en' ? ' (inglés)' : ''),
  fecha: new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(n.fecha + 'T12:00:00Z')),
  fechaISO: n.fecha, titulo: n.titulo, bajada: n.resumen, categoria: n.categoria,
  imagen: n.imagen?.src ?? IMG, enlace: n.url,
  credito: n.imagen?.credito, licencia: n.imagen?.licencia, licenciaUrl: n.imagen?.licenciaUrl,
});
for (const n of [...noticias.notas].sort((a, b) => b.fecha.localeCompare(a.fecha))) {
  let seccion = seccionesNoticias.find(s => s.titulo === '_' + n.tema);
  if (!seccion) { seccion = { titulo: '_' + n.tema, tarjetas: [] }; seccionesNoticias.push(seccion); }
  seccion.tarjetas.push(tarjetaNoticia(n));
}

export const PAGINAS: Record<'noticias' | 'investigaciones', Pagina> = {
  noticias: {
    titulo: 'Noticias y Novedades',
    bajada: 'Actualidad antártica, ciencia y expediciones.',
    modelo: { url: '/assets/models/antena-parabolica-web.glb', nombre: 'antena parabólica', giro: -0.6, elevacion: 0.22 },
    ejemplo: false, // plantilla sin rótulo visible (ver arriba)
    secciones: seccionesNoticias,
  },
  investigaciones: {
    titulo: 'Investigaciones',
    bajada: 'Ciencia y papers de la Antártida y Tierra del Fuego.',
    modelo: { url: '/assets/models/estacion-comunicaciones-web.glb', nombre: 'estación de comunicaciones', giro: -0.5, elevacion: 0.2 },
    ejemplo: false, // plantilla sin rótulo visible (ver arriba)
    papers: investigaciones.papers,
    secciones: [
      { titulo: '_Ciencia antártica · CONICET / CADIC', tarjetas: [...noticias.notas.filter(n => /CONICET/.test(n.organismo)), ...investigaciones.noticias].sort((a, b) => b.fecha.localeCompare(a.fecha)).map(tarjetaNoticia) },
    ],
  },
};
