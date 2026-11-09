# Antaris Polar

Plataforma web educativa e inmersiva sobre ciencia antártica. Prototipo para **SoberaníaTech 2026**, Eje 02: Antártida, Ciencia y Conocimiento Abierto.

> Estado: prototipo temprano. Los contenidos marcados como **borrador** no están verificados.

## Cómo correrlo

Requiere Node 20 o superior.

```bash
npm install
npm run dev
```

Abrí http://localhost:3000.

## Estructura

| Ruta | Qué es |
|---|---|
| `src/app/page.tsx` | Home: escena de exploración y lista accesible de puntos |
| `src/app/descubrir/page.tsx` | Índice de descubrimientos (acceso sin 3D) |
| `src/app/descubrir/[slug]/page.tsx` | Página educativa: objetivo, explicación, evidencia y fuentes |
| `src/content/` | Contenido editorial tipado (`types.ts`) y datos (`descubrimientos.ts`) |
| `src/components/` | Componentes de interfaz reutilizables |

## Rigor del contenido

Cada afirmación declara su tipo de evidencia (observación, modelo, simulación, hipótesis, conclusión o reconstrucción artística) y las fuentes que la sostienen. Un descubrimiento solo pasa a `verificado` cuando sus fuentes fueron revisadas (URL, acceso, licencia, escala y fecha).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · CSS Modules.
