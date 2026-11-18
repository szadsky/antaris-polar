# Navegación común de Antaris Polar

La misma barra en los sitios del sitio armado: hero (`/`), visor de bases (`/descubrir/`), laboratorio del
pingüino (`/laboratorio/pinguino/`) e islas de práctica (`/pinguino-menu/`). La trivia (`/antarisplay/`) es estática y
no la lleva todavía. El diseño viene del Figma «Gamezone ·
david», nodo `2597:1016`, al 80 % de su tamaño a 1920 px y proporcional al ancho.

## Uso

Primera importación del punto de entrada de cada sitio:

```ts
import { mountSiteNav } from '../../../compartido/navbar/navbar';
mountSiteNav({ actual: 'descubrir' }); // 'inicio' | 'descubrir' | 'antarisplay' | 'noticias' | 'investigaciones' | 'laboratorio' | 'islas'
```

Cada `vite.config` habilita esta carpeta en `server.fs.allow`, porque está fuera del proyecto.

- **Lugar en la página:** la barra se agrega al principio del `<body>`, después de un `a.skip` si existe. Es fija
  arriba y publica su alto en la variable `--site-nav-h` del `<html>`. Cada sitio suma esa variable a los `top` de lo
  que tiene anclado arriba. El canvas 3D sigue a pantalla completa, así que no cambian los cálculos de cámara ni de
  clics.
- **Enlaces:** usan las rutas del sitio armado. En desarrollo apuntan a `npm run preview` (http://127.0.0.1:3410), o a
  `VITE_SITIO` si está definida.
- **Ítems:**
  - Home → hero (`/`).
  - AntarisPlay → trivia «Rumbo a la Antártida» (`/antarisplay/`, copiada tal cual por `scripts/assemble-site.mjs`).
  - Bases → visor de bases (`/descubrir/`).
  - Noticias → `/noticias/` e Investigaciones → `/investigaciones/`: páginas del proyecto del hero (multipágina, Figma
    2529:5), publicadas en la raíz junto al hero.
  - El laboratorio y las islas siguen publicados en sus rutas, pero ya no están en la barra.
- **Página actual:** queda subrayada y marcada con `aria-current`.
- **Pantallas de 760 px o menos:** la barra se convierte en un botón «Menú» con la lista completa.
- **Teclado:** Escape cierra el menú del celular; el foco se ve con un anillo oscuro.
- **Visibilidad:** está siempre visible, también con «Ocultar interfaz». Se oculta solo en los modos de captura:
  `body.captura` en el visor y `html.limpio` en el hero.

## Sitio público y exploraciones (`compartido/modo.ts`)

Cada sección se publica dos veces con el mismo código:

| Pública (sin controles) | Exploración (con sus parámetros editables) |
|---|---|
| `/` (hero) | `/exploraciones-home/` |
| `/descubrir/` (Bases) | `/exploraciones-bases/` |
| `/laboratorio/pinguino/` | `/exploraciones-pinguino/` |
| `/pinguino-menu/` | `/exploraciones-islas/` |

- Índice de las exploraciones: `/exploraciones/` (fuera de la barra; se entra por la dirección).
- `mountSiteNav` llama a `aplicarModo()`: con controles en desarrollo, bajo `/exploraciones…` o con `?controles`; sin controles en el resto o con `?publico` (sirve para ver la versión pública en desarrollo). Sin controles, `<html>` lleva la clase `sin-controles`.
- Hero: el panel de profundidad solo se monta con controles. Bases: sin controles se ocultan estilo, sol y hora, ajustes de vista, rendimiento y los controles de edificios, y se apagan los atajos A, D y M; quedan la base, los datos y fuentes y «Ocultar interfaz». El laboratorio y las islas son páginas de prueba: no cambian.
- `scripts/assemble-site.mjs` copia el HTML de cada sección a su ruta de exploración (los recursos se piden por ruta absoluta) y genera el índice.

## Tipografía

El diseño usa Suisse Intl, que tiene licencia comercial. Se usa Geist Medium, con licencia SIL OFL 1.1: solo el
subconjunto latino, de 13 KB, en `fuentes/`, junto a su licencia.
