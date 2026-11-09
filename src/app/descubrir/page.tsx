import type { Metadata } from "next";
import { descubrimientos } from "@/content/descubrimientos";
import { DescubrimientoCard } from "@/components/DescubrimientoCard";
import styles from "./descubrir.module.css";

export const metadata: Metadata = {
  title: "Descubrimientos",
  description: "Todos los puntos del recorrido, accesibles sin necesidad de la vista 3D.",
};

export default function DescubrirIndex() {
  return (
    <div className={`container ${styles.page}`}>
      <header className={styles.intro}>
        <p className="eyebrow">Recorrido piloto · caleta Potter</p>
        <h1 className={styles.title}>Descubrimientos</h1>
        <p className={styles.lede}>
          Cada punto del paisaje responde una pregunta científica. Esta lista ofrece el mismo
          contenido que el recorrido 3D, para leerlo directamente.
        </p>
      </header>
      <ul className={styles.list}>
        {descubrimientos.map((d) => (
          <li key={d.slug}>
            <DescubrimientoCard d={d} />
          </li>
        ))}
      </ul>
    </div>
  );
}
