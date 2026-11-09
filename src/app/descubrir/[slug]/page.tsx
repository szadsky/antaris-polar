import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { descubrimientos, getDescubrimiento } from "@/content/descubrimientos";
import { EstadoBadge, EvidenciaBadge } from "@/components/Badges";
import styles from "./descubrimiento.module.css";

export function generateStaticParams() {
  return descubrimientos.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/descubrir/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const d = getDescubrimiento(slug);
  if (!d) return {};
  return { title: d.pregunta, description: d.resumen };
}

/**
 * Con Cache Components, `params` se lee dentro de <Suspense> para que la
 * navegación sea instantánea. Los slugs conocidos se prerenderan igual
 * gracias a generateStaticParams; el fallback solo aparece en casos raros.
 */
export default function DescubrimientoPage({ params }: PageProps<"/descubrir/[slug]">) {
  return (
    <Suspense fallback={<div className={`container ${styles.page}`} aria-busy="true" />}>
      <DescubrimientoArticle params={params} />
    </Suspense>
  );
}

async function DescubrimientoArticle({
  params,
}: {
  params: PageProps<"/descubrir/[slug]">["params"];
}) {
  const { slug } = await params;
  const d = getDescubrimiento(slug);
  if (!d) notFound();

  const fuentePorId = new Map(d.fuentes.map((f) => [f.id, f]));
  const relacionados = d.relacionados
    .map((s) => getDescubrimiento(s))
    .filter((r) => r !== undefined);

  return (
    <article className={`container ${styles.page}`}>
      <nav aria-label="Ruta de navegación" className={styles.breadcrumb}>
        <ol>
          <li>
            <Link href="/">Explorar</Link>
          </li>
          <li>
            <Link href="/descubrir">Descubrimientos</Link>
          </li>
          <li aria-current="page">{d.lugar}</li>
        </ol>
      </nav>

      <header className={styles.header}>
        <p className="eyebrow">{d.lugar}</p>
        <h1 className={styles.title}>{d.pregunta}</h1>
        <EstadoBadge estado={d.estado} />
        {d.estado !== "verificado" && (
          <p className={styles.warning} role="note">
            Este contenido es un borrador y todavía no fue verificado contra sus fuentes. No lo
            cites como referencia.
          </p>
        )}
      </header>

      <div className={styles.body}>
        <section aria-labelledby="objetivo" className={styles.objective}>
          <h2 id="objetivo">Qué vas a aprender</h2>
          <p>{d.objetivoAprendizaje}</p>
          <h3>Qué vas a hacer</h3>
          <p>{d.accion}</p>
        </section>

        <section aria-labelledby="explicacion" className={styles.section}>
          <h2 id="explicacion">Explicación</h2>
          {d.explicacion.map((parrafo, i) => (
            <p key={i}>{parrafo}</p>
          ))}
        </section>

        <section aria-labelledby="evidencia" className={styles.section}>
          <h2 id="evidencia">Evidencia</h2>
          {d.evidencias.length === 0 ? (
            <p className={styles.empty}>
              Todavía no hay afirmaciones verificadas para este punto.
            </p>
          ) : (
            <ul className={styles.evidence}>
              {d.evidencias.map((e, i) => (
                <li key={i}>
                  <EvidenciaBadge tipo={e.tipo} />
                  <p>{e.afirmacion}</p>
                  <p className={styles.evidenceSources}>
                    Fuente:{" "}
                    {e.fuentes
                      .map((id) => fuentePorId.get(id)?.titulo ?? id)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="fuentes" className={styles.section}>
          <h2 id="fuentes">Fuentes e instituciones</h2>
          <ul className={styles.sources}>
            {d.fuentes.map((f) => (
              <li key={f.id}>
                <a href={f.url} target="_blank" rel="noopener noreferrer">
                  {f.titulo}
                  <span className="visually-hidden"> (se abre en una pestaña nueva)</span>
                </a>
                <span>{f.institucion}</span>
              </li>
            ))}
          </ul>
        </section>

        {d.pendiente && d.pendiente.length > 0 && (
          <section aria-labelledby="pendiente" className={styles.section}>
            <h2 id="pendiente">Pendiente de verificación</h2>
            <ul className={styles.pending}>
              {d.pendiente.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </section>
        )}

        {relacionados.length > 0 && (
          <section aria-labelledby="relacionados" className={styles.section}>
            <h2 id="relacionados">Conocimientos relacionados</h2>
            <ul>
              {relacionados.map((r) => (
                <li key={r.slug}>
                  <Link href={`/descubrir/${r.slug}`}>{r.pregunta}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className={styles.next}>
        <Link href="/#explorar" className="button button--primary">
          Volver al recorrido
        </Link>
        <Link href="/descubrir" className="button button--ghost">
          Ver todos los descubrimientos
        </Link>
      </footer>
    </article>
  );
}
