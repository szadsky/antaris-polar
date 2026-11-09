import Link from "next/link";
import { NavLink } from "./NavLink";
import styles from "./SiteHeader.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          Antaris <span>Polar</span>
        </Link>
        <nav aria-label="Principal">
          <ul className={styles.nav}>
            <li>
              <NavLink href="/">Explorar</NavLink>
            </li>
            <li>
              <NavLink href="/descubrir">Descubrimientos</NavLink>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
