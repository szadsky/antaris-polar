/**
 * Contenido de Noticias e Investigaciones.
 *
 * CONTENIDO DE EJEMPLO: la estructura sigue el Figma (nodo 2529:5), pero todavía no hay noticias ni investigaciones
 * verificadas cargadas. Los textos lo dicen y la página lo avisa; no se inventan autores, fechas ni titulares. Para
 * cargar contenido real, reemplazar cada tarjeta con: título, bajada, autor o institución, fecha, imagen con permiso de
 * uso y `enlace` a la fuente original (para investigaciones, la publicación o su registro en OpenAlex).
 */
export interface Tarjeta {
  autor: string;
  fecha: string;
  titulo: string;
  bajada: string;
  imagen: string;
  enlace?: string;
}
export interface Seccion { titulo: string; tarjetas: Tarjeta[] }
export interface Pagina {
  titulo: string;
  bajada: string;
  modelo: { url: string; nombre: string; giro?: number; elevacion?: number };
  ejemplo: boolean;
  secciones: Seccion[];
}

const IMG = '/secciones/tarjeta-ejemplo.webp';
// Plantilla: texto genérico de la estructura (sin titulares, autores ni fechas inventados). El usuario no quiere el
// rótulo «contenido de ejemplo» en la página; por eso el texto es de plantilla y no se parece a una noticia real.
const ejemplo = (tipo: 'noticia' | 'investigación', n: number): Tarjeta[] => Array.from({ length: n }, () => ({
  autor: tipo === 'noticia' ? 'Fuente' : 'Institución',
  fecha: 'Fecha',
  titulo: tipo === 'noticia' ? 'Título de la noticia' : 'Título de la investigación',
  bajada: tipo === 'noticia' ? 'Bajada de la noticia, con el enlace a su fuente original.' : 'Resumen del trabajo, con sus autores y el enlace a la publicación original.',
  imagen: IMG,
}));

export const PAGINAS: Record<'noticias' | 'investigaciones', Pagina> = {
  noticias: {
    titulo: 'Noticias y Novedades',
    bajada: 'Lo que pasa en la Antártida y en el ecosistema bicontinental, siempre con el enlace a la fuente original.',
    modelo: { url: '/assets/models/antena-parabolica-web.glb', nombre: 'antena parabólica', giro: -0.6, elevacion: 0.22 },
    ejemplo: false, // plantilla sin rótulo visible (ver arriba)
    secciones: [
      { titulo: '_Ambiente', tarjetas: ejemplo('noticia', 6) },
      { titulo: '_Expediciones', tarjetas: ejemplo('noticia', 6) },
    ],
  },
  investigaciones: {
    titulo: 'Investigaciones',
    bajada: 'Trabajos científicos sobre la Antártida y Tierra del Fuego, con sus autores, su institución y el acceso a la publicación original.',
    modelo: { url: '/assets/models/estacion-comunicaciones-web.glb', nombre: 'estación de comunicaciones', giro: -0.5, elevacion: 0.2 },
    ejemplo: false, // plantilla sin rótulo visible (ver arriba)
    secciones: [
      { titulo: '_Glaciología', tarjetas: ejemplo('investigación', 6) },
      { titulo: '_Biodiversidad', tarjetas: ejemplo('investigación', 6) },
    ],
  },
};
