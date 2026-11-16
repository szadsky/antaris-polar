# Navegación común de Antaris Polar

La misma barra en los cuatro sitios del sitio armado: hero (`/`), visor de bases (`/descubrir/`), laboratorio del
pingüino (`/laboratorio/pinguino/`) e islas de práctica (`/pinguino-menu/`). El diseño viene del Figma «Gamezone ·
david», nodo `2597:1016`, al 80 % de su tamaño a 1920 px y proporcional al ancho.

## Uso

Primera importación del punto de entrada de cada sitio:

```ts
import { mountSiteNav } from '../../../compartido/navbar/navbar';
mountSiteNav({ actual: 'descubrir' }); // 'inicio' | 'descubrir' | 'laboratorio' | 'islas'
```

Cada `vite.config` habilita esta carpeta en `server.fs.allow`, porque está fuera del proyecto.

- **Lugar en la página:** la barra se agrega al principio del `<body>`, después de un `a.skip` si existe. Es fija
  arriba y publica su alto en la variable `--site-nav-h` del `<html>`. Cada sitio suma esa variable a los `top` de lo
  que tiene anclado arriba. El canvas 3D sigue a pantalla completa, así que no cambian los cálculos de cámara ni de
  clics.
- **Enlaces:** usan las rutas del sitio armado. En desarrollo apuntan a `npm run preview` (http://127.0.0.1:3410), o a
  `VITE_SITIO` si está definida.
- **Ítems:**
  - Descubrir.
  - Laboratorio: un submenú con «Pingüino y nieve» e «Islas de práctica».
  - Investigación, Quienes somos y Contacto: no tienen página todavía y se muestran con «próximamente», sin enlace.
- **Página actual:** queda subrayada y marcada con `aria-current`.
- **Pantallas de 760 px o menos:** la barra se convierte en un botón «Menú» con la lista completa.
- **Teclado:** Escape cierra el menú y el submenú; el foco se ve con un anillo oscuro.
- **Visibilidad:** está siempre visible, también con «Ocultar interfaz». Se oculta solo en los modos de captura:
  `body.captura` en el visor y `html.limpio` en el hero.

## Tipografía

El diseño usa Suisse Intl, que tiene licencia comercial. Se usa Geist Medium, con licencia SIL OFL 1.1: solo el
subconjunto latino, de 13 KB, en `fuentes/`, junto a su licencia.
