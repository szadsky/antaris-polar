import { etiquetaEstado, etiquetaEvidencia } from "@/content/descubrimientos";
import type { EstadoVerificacion, TipoEvidencia } from "@/content/types";
import styles from "./Badges.module.css";

export function EstadoBadge({ estado }: { estado: EstadoVerificacion }) {
  return (
    <span className={`${styles.badge} ${styles[estado]}`}>{etiquetaEstado[estado]}</span>
  );
}

export function EvidenciaBadge({ tipo }: { tipo: TipoEvidencia }) {
  return <span className={`${styles.badge} ${styles.evidencia}`}>{etiquetaEvidencia[tipo]}</span>;
}
