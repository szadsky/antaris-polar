import Link from "next/link";
import type { Descubrimiento } from "@/content/types";
import { EstadoBadge } from "./Badges";
import styles from "./DescubrimientoCard.module.css";

/** Tarjeta de un punto: es la vía HTML equivalente a encontrarlo en el terreno 3D. */
export function DescubrimientoCard({
  d,
  tone = "page",
}: {
  d: Descubrimiento;
  tone?: "page" | "scene";
}) {
  return (
    <article className={`${styles.card} ${styles[tone]}`}>
      <p className={styles.lugar}>{d.lugar}</p>
      <h3 className={styles.pregunta}>
        <Link href={`/descubrir/${d.slug}`} className={styles.link}>
          {d.pregunta}
        </Link>
      </h3>
      <p className={styles.resumen}>{d.resumen}</p>
      <EstadoBadge estado={d.estado} />
    </article>
  );
}
