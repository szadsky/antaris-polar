import type { Descubrimiento, TipoEvidencia, EstadoVerificacion } from "./types";

/**
 * Descubrimientos del recorrido piloto (caleta Potter).
 *
 * IMPORTANTE: este contenido es un BORRADOR estructural. No contiene
 * afirmaciones científicas todavía; se completan solo con fuentes
 * verificadas (URL, acceso, licencia, escala y fecha revisadas).
 */
export const descubrimientos: Descubrimiento[] = [
  {
    slug: "frente-glaciar-caleta-potter",
    lugar: "Frente glaciar · caleta Potter, isla 25 de Mayo",
    pregunta: "¿Qué cambia en la caleta cuando el frente del glaciar retrocede?",
    resumen:
      "Punto piloto del recorrido. Conecta el paisaje del frente glaciar con investigaciones sobre la caleta. El contenido científico se publica a medida que se verifican las fuentes.",
    objetivoAprendizaje:
      "Relacionar un cambio visible en el paisaje (la posición del frente glaciar) con procesos que ocurren en el agua y en el fondo de la caleta, distinguiendo qué está medido y qué es interpretación.",
    accion:
      "Ubicar el frente glaciar en el terreno, comparar su posición en distintas fechas y abrir la evidencia que respalda cada observación.",
    explicacion: [
      "Esta sección contendrá una explicación breve y accesible, escrita a partir de publicaciones revisadas por pares y de datos de instituciones que investigan en la zona.",
      "Hasta que esas fuentes estén verificadas, el punto se muestra como borrador y no presenta cifras ni conclusiones.",
    ],
    evidencias: [],
    fuentes: [
      {
        id: "iaa",
        titulo: "Instituto Antártico Argentino",
        institucion: "Dirección Nacional del Antártico",
        url: "https://www.cancilleria.gob.ar/es/iniciativas/dna/instituto-antartico-argentino",
        tipo: "institucion",
      },
      {
        id: "cadic",
        titulo: "Centro Austral de Investigaciones Científicas",
        institucion: "CADIC-CONICET",
        url: "https://cadic.conicet.gov.ar/",
        tipo: "institucion",
      },
      {
        id: "rema",
        titulo: "Reference Elevation Model of Antarctica (REMA)",
        institucion: "Polar Geospatial Center",
        url: "https://www.pgc.umn.edu/data/rema/",
        tipo: "dataset",
      },
    ],
    relacionados: [],
    estado: "borrador",
    pendiente: [
      "Identificar publicaciones revisadas por pares sobre la caleta y verificar acceso y licencia.",
      "Confirmar fechas y fuentes de las posiciones del frente glaciar.",
      "Redactar la explicación accesible y clasificar cada afirmación por tipo de evidencia.",
    ],
  },
];

export function getDescubrimiento(slug: string): Descubrimiento | undefined {
  return descubrimientos.find((d) => d.slug === slug);
}

export const etiquetaEvidencia: Record<TipoEvidencia, string> = {
  observacion: "Observación",
  modelo: "Modelo",
  simulacion: "Simulación",
  hipotesis: "Hipótesis",
  conclusion: "Conclusión",
  "reconstruccion-artistica": "Reconstrucción artística",
};

export const etiquetaEstado: Record<EstadoVerificacion, string> = {
  borrador: "Borrador · sin verificar",
  "en-revision": "En revisión",
  verificado: "Verificado",
};
