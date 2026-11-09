import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container" style={{ paddingBlock: "96px", display: "grid", gap: 16, justifyItems: "start" }}>
      <p className="eyebrow">Error 404</p>
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: "clamp(2.5rem, 6vw, 4rem)" }}>
        Este lugar no está en el mapa
      </h1>
      <p style={{ color: "var(--ink-soft)" }}>La página que buscás no existe o cambió de dirección.</p>
      <Link href="/descubrir" className="button button--primary">
        Ver los descubrimientos
      </Link>
    </div>
  );
}
