import Link from "next/link";
import { descubrimientos } from "@/content/descubrimientos";
import { DescubrimientoCard } from "@/components/DescubrimientoCard";
import styles from "./page.module.css";

export default function Home() {
  return (
    <>
      <section className={styles.scene} aria-labelledby="titulo-home">
        <div className={`container ${styles.hero}`}>
          <p className={styles.eyebrow}>Caleta Potter · isla 25 de Mayo · Antártida</p>
          <h1 id="titulo-home" className={styles.title}>
            Explorar para <em>descubrir</em>
          </h1>
          <p className={styles.lede}>
            Recorré un lugar real de la Antártida y revelá la ciencia que lo estudia: qué se mide,
            quién lo investiga y dónde leer las fuentes originales.
          </p>
          <div className={styles.actions}>
            <a href="#explorar" className="button button--primary">
              Empezar a explorar
            </a>
            <Link href="/descubrir" className="button button--ghost">
              Ver todos los descubrimientos
            </Link>
          </div>
        </div>

        <div id="explorar" className={`container ${styles.explore}`}>
          {/* Lugar reservado para el terreno 3D (prueba P2). No muestra relieve:
              solo se dibujará terreno cuando provenga de datos REMA verificados. */}
          <figure className={styles.viewport} aria-labelledby="viewport-nota">
            <div className={styles.viewportInner} aria-hidden="true" />
            <figcaption id="viewport-nota" className={styles.viewportNote}>
              <strong>Vista 3D del terreno en desarrollo.</strong> El relieve se mostrará solo
              cuando provenga de datos de elevación verificados. Mientras tanto, los puntos están
              disponibles en la lista.
            </figcaption>
          </figure>

          <div className={styles.points}>
            <h2 className={styles.pointsTitle}>Puntos de este recorrido</h2>
            <ul className={styles.pointsList}>
              {descubrimientos.map((d) => (
                <li key={d.slug}>
                  <DescubrimientoCard d={d} tone="scene" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={`container ${styles.how}`} aria-labelledby="como-funciona">
        <h2 id="como-funciona" className={styles.howTitle}>
          Cómo funciona
        </h2>
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNum}>01</span>
            <h3>Explorá</h3>
            <p>Recorré el paisaje o usá la lista: los dos caminos llevan a los mismos contenidos.</p>
          </li>
          <li>
            <span className={styles.stepNum}>02</span>
            <h3>Descubrí</h3>
            <p>Cada punto responde una pregunta científica concreta sobre ese lugar.</p>
          </li>
          <li>
            <span className={styles.stepNum}>03</span>
            <h3>Profundizá</h3>
            <p>
              Leé la evidencia, distinguí qué es observación, modelo o interpretación, y seguí los
              enlaces a las fuentes originales.
            </p>
          </li>
        </ol>
      </section>
    </>
  );
}
