import styles from "./SiteFooter.module.css";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`container ${styles.inner}`}>
        <p>
          Antaris Polar · Prototipo para SoberaníaTech 2026, Eje 02: Antártida, Ciencia y
          Conocimiento Abierto.
        </p>
        <p>
          Los contenidos enlazan a sus fuentes originales. Lo marcado como borrador todavía no está
          verificado.
        </p>
      </div>
    </footer>
  );
}
