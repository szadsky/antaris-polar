/**
 * Modelo de contenido editorial de Antaris Polar.
 *
 * Regla de rigor (CLAUDE.md §7): toda afirmación declara qué tipo de
 * evidencia es y de qué fuente sale. Nunca hacer pasar una simulación
 * o una reconstrucción artística por una medición.
 */

/** Categorías de evidencia que la interfaz distingue de forma explícita. */
export type TipoEvidencia =
  | "observacion"
  | "modelo"
  | "simulacion"
  | "hipotesis"
  | "conclusion"
  | "reconstruccion-artistica";

/** Estado editorial: solo "verificado" puede presentarse sin advertencia. */
export type EstadoVerificacion = "borrador" | "en-revision" | "verificado";

export interface Fuente {
  id: string;
  titulo: string;
  institucion: string;
  url: string;
  /** Qué es la fuente: portal de datos, publicación, institución… */
  tipo: "dataset" | "publicacion" | "institucion" | "portal";
  /** Fecha ISO en la que se revisó el enlace. */
  revisada?: string;
}

export interface Evidencia {
  afirmacion: string;
  tipo: TipoEvidencia;
  /** Ids de `Fuente` que sostienen la afirmación. Nunca vacío si está verificada. */
  fuentes: string[];
}

export interface Descubrimiento {
  slug: string;
  /** Lugar del paisaje donde se encuentra el punto. */
  lugar: string;
  /** Pregunta científica que responde el descubrimiento. */
  pregunta: string;
  resumen: string;
  /** 1) Objetivo de aprendizaje (CLAUDE.md §3). */
  objetivoAprendizaje: string;
  /** 2) Acción relevante que hace el usuario. */
  accion: string;
  /** 4) Explicación accesible, un párrafo por elemento. */
  explicacion: string[];
  /** 3) Evidencia con su tipo y sus fuentes. */
  evidencias: Evidencia[];
  fuentes: Fuente[];
  /** 5) Slugs de otros descubrimientos relacionados. */
  relacionados: string[];
  estado: EstadoVerificacion;
  /** Qué falta para pasar a "verificado". */
  pendiente?: string[];
}
