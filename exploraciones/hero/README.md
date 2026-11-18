# Hero de Antaris Polar (exploración aislada)

Sección hero de la página principal, armada fuera del visor (`terreno-estilizado`) y del laboratorio (`penguin-lab`): no
modifica ninguno de los dos, copia lo que necesita. Reproduce la composición de la tercera variante del hero
(`fuente/referencia-tercera.png`, 1672 × 941) con una sola escena Three.js r181:

| Parte | Cómo está hecha |
| --- | --- |
| Cielo, cumbres, laderas | Capas pintadas del zip en planos a 20, 9 y 5 km. Cumbres y laderas con **parallax por profundidad** (Depth Anything V2, una pasada por capa) como malla elástica. |
| Barcos y boyas | Recortes de la capa 06, parados sobre el agua en su línea de flotación (60–800 m). |
| Agua (canal Beagle) | `Water` de three con reflejo planar real de los barcos, color por fila tomado del agua pintada, estelas verticales, ondulación y trocitos de hielo. |
| Loma nevada | **Terreno generado** (heightfield 3D de 16 × 16 m) con el **material de nieve y roca del visor** y el horneado de mapas de las islas del laboratorio, ajustado a la silueta de la capa 07. **No usa Depth Anything.** |
| Pasto seco | Recortes de la capa 07 en tiras paradas sobre la loma. |
| Pingüino | Modelo del laboratorio con los colores de `king-penguin-colors.ts`, de espaldas, animación «Idle», cabeza girada a la derecha. |

Todo es **reconstrucción artística**. No hay geografía medida, ni relieve REMA, ni fotografía (ver «Qué es reconstrucción
artística»).

## Cómo correrlo

```bash
cd exploraciones/hero
npm install
npm run dev        # http://127.0.0.1:3420  (en la app: configuración «hero» de .claude/launch.json)
npm run build      # tsc + vite build → dist/
```

Parámetros de la URL:

| Parámetro | Efecto |
| --- | --- |
| `?medir` | Muestra FPS y ms por cuadro (mediana y p95). Habilita `__heroBench(n)` en la consola. |
| `?quieto` | Cámara fija (lo mismo que hace «reducir movimiento» del sistema). |
| `?limpio` | Sin interfaz (solo la escena). |
| `?referencia` | Sin interfaz y con el hero exactamente de 1672 × 941. Es el modo de las capturas de comparación. |
| `?dpr=1` | Resolución interna fija (desactiva la calidad adaptativa). |
| `?sinwebgl` | Fuerza la alternativa sin WebGL (imagen fija). |
| `?panel` | Muestra el panel de profundidad de las montañas también en el build (en desarrollo se ve siempre, salvo con `?limpio` / `?referencia`). |
| `?sol=x,y,z` | Dirección hacia el sol, para pruebas (por defecto `-0.7,0.62,-0.36`, ~38° de altura). La sombra horneada de la loma se recalcula con ella. |

En desarrollo, `__heroCapture('nombre')` guarda el canvas en `capturas/nombre.png` (middleware de `vite.config.mjs`) y
`__heroPose(x, y, scroll)` fija la cámara. Con eso se tomaron todas las capturas en el navegador de la app.

## Navegación y copys (Figma)

Diseño: archivo Figma «Gamezone · david», navbar `2597:1016` y hero `2534:25` (marco de 1920 px).

- **Navbar:** es la navegación común de todos los sitios, en `compartido/navbar/` (ver su README). El hero la monta
  desde `src/main.ts` con `mountSiteNav({ actual: 'inicio' })`. En el sitio armado el hero está en `/`.
- **Copys del hero:** título «La Antártida, tan cerca como nunca» (Geist Light), el subtítulo (Geist Medium) y las coordenadas de Ushuaia
  `[-68.30833, -54.80833]` (longitud, latitud; IBM Plex Mono). El lector de pantalla oye «Ushuaia: longitud…, latitud…».
- **Diferencias con Figma, y por qué:**
  - **Escala al 80 % del diseño** (pedido del usuario: «está muy grande la UI»), proporcional al ancho de la ventana con
    mínimos legibles: a 1920 px, título 58 px (Figma 72), subtítulo 16 (20), barra 13 px de texto y 538 px de ancho
    (16 y 672); a 1086 px, título 33 px, barra 12 px y 447 px de ancho. El título reparte sus líneas (`text-wrap: balance`).
  - **Tipografía de la navbar:** el diseño usa Suisse Intl, que tiene licencia comercial y no está en el proyecto. Se
    usa Geist Medium; la cápsula queda 2 px más angosta (670 vs. 672 px).
  - **Copys en blanco** (pedido del usuario: más contraste que el #262626 del Figma), con un velo oscuro suave detrás
    del título (`.hero::before`) y otro desde el borde inferior (`.hero::after`), más una sombra leve en el texto.
  - **Subtítulo y coordenadas atados al borde inferior** de la ventana (pedido del usuario): 46 y 22 px desde abajo; en
    celular, 76 y 54 px, por encima de la nota de reconstrucción artística.
  - **Sin la línea de cumbres** (vector 2587:439, trazo claro detrás del título): se quitó a pedido del usuario.
  - **Foco** de la navbar oscuro (`#232c45`), porque el amarillo general no se ve sobre la cápsula clara.

**Contraste medido** (texto blanco contra la imagen en reposo, 1440 × 900, sobre el 5 % más claro de los píxeles
detrás de cada texto):

| Texto | Sin velo | Con velo | Mínimo AA |
| --- | --- | --- | --- |
| Título (texto grande) | 4,49:1 | **6,21:1** | 3:1 |
| Subtítulo | 1,46:1 | **5,20:1** | 4,5:1 |
| Coordenadas (11 px) | 1,80:1 | **7,67:1** | 4,5:1 |

## Transición al hacer scroll

Al scrollear, una máscara cubre el hero desde los bordes hacia el centro y termina en el color de fondo de la sección
de abajo, así no hay corte entre el hero y lo que sigue. La barra y la marca quedan encima. Pedidos del usuario: «al
hacer scroll… adaptarse al color de la sección de abajo… para evitar el corte abrupto, como una especie de
enmascaramiento»; sin «nieve» (partículas) y sin el efecto tipo plexus: nada de líneas, triángulos, celdas ni malla.

- **Recorrido:** el hero queda fijo (`position: sticky`) dentro de `#hero-track`, que suma `--frost-scroll` (110 svh)
  de scroll. El avance por ese tramo (0…1) es el progreso; al terminar, el hero ya es del color de la sección y la
  página sigue sin corte. La cámara sube un poco con el mismo progreso.
- **Máscara** (`src/frost.ts`): borde orgánico (ruido de baja frecuencia, lento) y ancho (franja de 0,22 de la distancia
  borde–centro). En la franja la imagen se esmerila (desenfoque leve de 8 muestras) con un tinte frío, y se funde en el
  color final. Con progreso 1 todo es ese color (verificado leyendo píxeles: `rgb(244, 247, 251)`).
- **Color:** se lee de la página, no está fijo. Es el primer fondo no transparente desde `#contenido` hacia arriba (hoy
  el de `<body>`, `var(--paper)`), y se vuelve a leer si cambia el esquema claro / oscuro.
- **Cómo:** la escena se dibuja como siempre; si hay progreso, ese cuadro final (ya con tone mapping y en sRGB) se copia
  a una textura (`copyFramebufferToTexture`) y encima se dibuja un triángulo de pantalla completa con la máscara, en el
  mismo espacio de color que el CSS. **Con progreso 0 no se hace nada.**
- **Textos:** cada uno se apaga cuando el frente llega a su esquina más expuesta, y su velo con él. El velo del título,
  más ancho que el título, se apaga antes para no ensuciar de gris lo ya cubierto. La nota de reconstrucción artística
  también se apaga; la misma información está en «Sobre esta imagen», debajo del hero.
- **Reducir movimiento:** la máscara sigue al scroll (la maneja el usuario), pero el borde queda quieto.
- **Costo** (temporizador de GPU `EXT_disjoint_timer_query_webgl2`, 1009 × 768, GPU AMD Radeon integrada): escena 3,7 ms;
  escena + máscara 4,4–4,7 ms, o sea **≈ 0,7–1,0 ms** de la máscara. La versión anterior, con cristales y malla, costaba
  ≈ 3,5 ms. `readPixels` no sirvió para medir: quedaba atado al refresco de la pantalla (16,7 ms).
- **Desarrollo:** `__heroFrost(p)` fija el progreso y dibuja el cuadro en el momento (capturas, aun con la pestaña
  oculta); `__heroFrost(null)` vuelve al scroll.
- **Capturas:** `capturas/11-transicion-mascara-scroll.jpg` (reposo y scroll al 15, 35, 60, 85 y 100 %).

## Última sección: el pingüino en las islas

Pedido del usuario: «que la navegación del pingüino en el terreno 3D esté debajo, en la última sección del home, con
un efecto medio de vignette así se integra con el sitio». Es la forma de llegar al pingüino desde el home: el
laboratorio y las islas ya no están en la barra.

- **Qué es:** las islas de práctica de `exploraciones/penguin-lab` (`/pinguino-menu/`), incrustadas con un iframe en
  `/pinguino-menu/?embed`. Son relieve **sintético** (ruido y erosión), no REMA, y la sección lo dice.
- **Por qué un iframe:** es otra escena completa, con su propio Three.js, modelos, texturas y bucle. Incrustada no
  comparte memoria de GPU ni código con el hero, y la ruta es la misma que se publica sola. Montar la escena dentro del
  bundle del hero habría sumado su código al home y mezclado dos bucles en la misma página.
- **Carga diferida** (`src/islas.ts`): el iframe recién se crea cuando la sección está a menos de una pantalla
  (IntersectionObserver). Antes de eso, el home no descarga nada de las islas: verificado, sin ninguna petición a
  `/pinguino-menu/` ni `/laboratorio/pinguino/`. El hero arranca igual que antes. Con «reducir movimiento» se carga
  solo con el botón.
- **Pausa:** cuando la sección sale de vista, el home le pide a las islas que dejen de dibujar (`postMessage`
  `antaris:pausa` / `antaris:sigue`, solo del mismo origen). Medido contando llamadas de dibujo dentro del iframe:
  **0** con el hero en pantalla y 1586 en 4 s con la sección en vista. En desarrollo, el home y las islas están en
  puertos distintos y la pausa no aplica; el navegador ya frena los iframes de otro origen fuera de pantalla.
- **Rueda y teclado:** sin activar, una capa deja pasar la rueda al scroll de la página, porque si no la rueda haría
  zoom en la escena y el home quedaría trabado. «Explorar las islas», o un clic en la escena, la activa y le da el
  foco, así W A S D funcionan. Se desactiva al sacar el puntero o al salir de vista.
- **Viñeta media (máscara del frame):** una máscara CSS sobre el propio iframe (`mask-image`), no una capa pintada
  encima: la escena se vuelve transparente hacia afuera y deja ver el fondo real de la página.
  - Forma: un óvalo suave (sin esquinas ni lados rectos) por un fundido vertical más ancho arriba (37 % del alto) que
    abajo (24 %).
  - Grano: es un SVG con ruido `feTurbulence` sumado al alfa (±4 %), que trama los escalones del degradado. Lo
    genera `scripts/mascara-islas.cjs`.
  - Medido renderizando la máscara: sin grano, el alfa de una columna tenía mesetas de hasta 30 px con el mismo valor
    (los escalones visibles); con grano, la más larga es de 6 px.
  - Historial: la primera versión (sombra interior y degradado radial encima) dejaba un corte recto arriba, y la
    segunda (dos degradados lineales) todavía se leía como un rectángulo.
  - El iframe no tiene borde, sombra ni radio. Además, en el modo incrustado el panel del selector de isla ya no tiene
    caja propia, porque su borde recto también se veía como un recuadro.
  - Captura: `capturas/14-islas-mascara-con-grano.jpg` (frame completo y borde superior ampliado ×4).
- **Modo incrustado de las islas** (`penguin-lab/src/menu-main.ts` y `menu.css`, con `?embed`):
  - sin la barra común (la del home ya está arriba);
  - **solo la isla Sendero**, sin selector (pedido del usuario: «que no esté en el medio, eliminá Macizo y Valle
    encerrado del home»). `/pinguino-menu/` y `/exploraciones-islas/` siguen con las tres islas;
  - «Sonido» y «Restablecer vista» en la esquina superior derecha de la zona nítida de la máscara (≈ 38 % del alto,
    59–83 % del ancho), lejos del pingüino; en pantallas táctiles, apilados. Los controles táctiles quedan por encima
    del fundido inferior y no hay «Ocultar interfaz» (queda la tecla H). Captura: `capturas/15-islas-solo-sendero.jpg`;
  - solo el selector de isla y los controles de la escena. El título, la descripción, la ayuda de teclas, el editor de
    estructuras y el pie quedan en el home: las teclas debajo del marco, y los créditos del pingüino (Polyfork,
    CC BY 4.0) y de las huellas (Oguzhan Tufenk / Codrops, MIT).
- **Costo al llegar a la sección:** ≈ 6,1 MB de las islas, medidos en el servidor de prueba, que no comprime: el JS
  baja menos con gzip. Lo más pesado es el pingüino sin optimizar (`penguin-custom-smooth.glb`, 1,16 MB; en el hero se
  usa la versión reducida de 351 KB) y cuatro estructuras de ≈ 0,7–0,8 MB cada una.
- **Capturas:** `capturas/12-islas-en-el-home.jpg` (antes / después, escritorio y celular).

## Noticias e Investigaciones

Páginas interiores con la estructura del Figma «Gamezone · david», nodo `2529:5`. El proyecto del hero es multipágina
(`vite.config.mjs`): `noticias/index.html` e `investigaciones/index.html`. En el sitio armado quedan en `/noticias/` y
`/investigaciones/` sin tocar `scripts/assemble-site.mjs`, porque el hero se publica en la raíz.

- **Estructura** (`src/secciones/pagina.ts` y `secciones.css`):
  - fondo `#d5e2e8`;
  - hero con el título (Geist Light) y la bajada a la izquierda, y el modelo 3D a la derecha;
  - dos secciones con carrusel: línea divisoria, título `_Sección`, flechas anterior y siguiente, tarjetas con borde
    blanco de 8 px, imagen, fuente y fecha en Geist Mono, título y bajada de 2 líneas, y contador `01/06`;
  - las tarjetas que no entran enteras quedan al 50 %, como en el Figma.

  Tamaños al 80 % del diseño a 1920 px y proporcionales al ancho, como el home. El carrusel es una lista con scroll
  horizontal: las flechas son botones (se apagan en los extremos) y el contador se anuncia con `aria-live`.
- **Modelos** (`src/secciones/modelo.ts`): Noticias usa la antena parabólica (`antena-parabolica-web.glb`) e
  Investigaciones, la estación de comunicaciones (`estacion-comunicaciones-web.glb`). Vienen del laboratorio, con
  Meshopt, texturas WebP y ≈ 52 300 triángulos cada uno. La imagen del Figma (nodo 2574:402) es el mockup del modelo.
  Son **modelos decorativos**: reconstrucción artística, no estructuras reales. Su procedencia y licencia están
  pendientes de documentar (`penguin-lab/LEEME.txt`), y la página lo aclara debajo del modelo.
  - **Escaneo al cargar:** una línea de luz sube por el propio modelo; debajo queda sólido y arriba su malla de alambre.
    Sin disco ni plano de luz, a pedido del usuario. Con «reducir movimiento», aparece directo.
  - **Parallax:** rotación leve con el mouse (giro ±0,2 rad e inclinación ±0,05 rad), suavizada.
  - **Fundido:** fondo transparente, más una máscara elíptica con grano (`scripts/mascara-modelo.cjs`, como la del
    Figma) que funde los bordes con el fondo de la página.
  - **Costo:** se dibuja a pedido, solo mientras escanea o mientras la rotación se acomoda, y solo en pantalla. En
    reposo no dibuja.
  - **Desarrollo:** `__modeloEscaneo(p)` fija el progreso del escaneo para las capturas.
- **Contenido:** todavía no hay noticias ni investigaciones verificadas. Las tarjetas tienen texto de plantilla
  («Título de la noticia», «Fuente», «Fecha») y una imagen del Figma. No hay titulares, autores ni fechas inventados.
  El usuario no quiere un rótulo «contenido de ejemplo» visible; el texto de plantilla deja claro que no es una noticia.
  Para cargar contenido real, editar `src/secciones/contenido.ts`: título, bajada, fuente o institución, fecha, imagen
  con permiso de uso y `enlace` a la fuente original (en investigaciones, la publicación o su registro en OpenAlex).
- **Barra:** `mountSiteNav({ actual: 'noticias' | 'investigaciones' })`. La página actual no tiene marca visual (pedido
  del usuario); queda marcada solo con `aria-current`.
- **Capturas:** `capturas/16-noticias-e-investigaciones.jpg`.

## Imagen de carga

`public/hero/estatica-render.webp` (94 KB) se ve al instante mientras carga el 3D, queda sola sin WebGL y es la
alternativa sin movimiento. **Es una captura del render final** (`scripts/imagen-estatica.mjs`, 1672 × 941, cámara en
reposo). Antes era la recomposición de las capas del zip (`estatica.webp`, 318 KB): al recargar se veían un momento el
pingüino pintado y la loma original. Cambió de nombre para que ningún navegador muestre la versión vieja guardada en
caché. Verificado recargando varias veces y con `?sinwebgl`.

## Capas del zip y cómo se usan

`fuente/` es el zip `antaris-hero-tercera-capas.zip` descomprimido sin cambios. Las capas van a 1672 × 941, apiladas
desde (0, 0).

| Capa | Uso |
| --- | --- |
| 01-cielo | `public/hero/cielo.webp` (fondo, 20 km). |
| 02-cumbres-nevadas | `cumbres.webp` (filas 140–452), plano a 9 km con parallax por profundidad. |
| 03-laderas-y-bruma | `laderas.webp` (filas 320–540), plano a 5 km con parallax por profundidad. |
| 04-canal-beagle | **No se publica.** Se toma la mediana por fila (sin reflejos, barcos ni terreno), suavizada ±6 filas → `agua-filas.json`, el color de fondo del agua. |
| 05-reflejos-de-barcos | **No se usa.** Los reflejos los calcula el agua (reflejo planar). Sirvió de referencia visual. |
| 06-barcos-y-boyas | 14 componentes → atlas `barcos.webp` + `barcos.json` (rectángulo y línea de flotación de cada uno). |
| 07-terreno-nevado | **No se publica como imagen.** Da `base-mascaras.webp` (roca, pasto y cobertura), con la que el terreno generado ajusta su silueta y pone la roca, y los recortes de pasto. |
| 08-pinguino | **No se usa.** Lo reemplaza el pingüino 3D del laboratorio. |

`scripts/inspeccionar-capas.mjs` y `scripts/hoja-de-capas.mjs` reproducen la revisión inicial de las capas (cobertura de
alfa y hoja de contacto).

## Profundidad de las montañas: Depth Anything V2

**Se usa solo en las montañas.** La loma es un terreno generado (ver «Loma: terreno generado»).

- **Modelo:** Depth Anything V2 **Small** (`depth-anything/Depth-Anything-V2-Small-hf`), en su exportación ONNX
  `onnx-community/depth-anything-v2-small`. Repositorio oficial: https://github.com/DepthAnything/Depth-Anything-V2
- **Licencia:** Apache-2.0. Los modelos Base y Large son **CC-BY-NC-4.0** (uso no comercial), por eso no se usan.
- **Cómo se corrió:** localmente, en esta máquina, sin GPU y **sin Python** (no hay Python instalado). El código oficial
  del repositorio es PyTorch, así que se usó el mismo modelo exportado a ONNX con `@huggingface/transformers` 3.x
  (transformers.js) y `onnxruntime-node`, en CPU. No es un modelo distinto: es la misma red, en otro runtime.
- **Una pasada por capa** (`scripts/profundidad-montanas.mjs`, metadatos en `profundidad/montanas.json`):

  | Capa | Lo que ve el modelo | Recorte | Entrada al modelo | Inferencia (CPU) |
  | --- | --- | --- | --- | --- |
  | Cumbres | cielo + cumbres (01 + 02): las partes que las laderas tapan también tienen su profundidad | filas 110–480 | 2338 × 518 | ≈ 7–8 s |
  | Laderas | cielo + cumbres + agua + laderas (01 + 02 + 04 + 03), sin barcos ni terreno | filas 110–640 | 1638 × 518 | ≈ 4–6 s |

  Lado corto 518 (el del entrenamiento), múltiplos de 14, sin deformar, fp32. Cada salida se normaliza dentro del alfa
  de su capa (percentiles 1–99, solo sobre la costa lejana, fila < 498). Después pasa por una mediana de 7 × 7, que
  borra los restos de mástiles pintados en la capa 03, y por un desenfoque de 1,5 px.
- **Assets** (filas 140–540, a media resolución porque la malla los lee cada 8 × 6 px; WebP **sin pérdida**: con
  pérdida, el submuestreo de color guardaba R y G a media resolución y aparecían rayas):
  - `public/hero/profundidad-montanas.webp` (39 KB): R = cumbres, G = laderas (0 = lejos, 1 = cerca).
  - `public/hero/relieve-montanas.webp` (69 KB): **relieve local** = profundidad − su promedio en ~18 px (convolución
    normalizada por el alfa de la capa, ×4, 128 = 0). Marca lo que sobresale o se hunde respecto de su entorno, así
    cada cresta y cada falda tienen volumen propio y no solo el degradado de atrás hacia adelante.
- **Corrección (16/11/2026):** `sharp` devuelve 3 canales después de `blur`. El script copiaba ese resultado como si
  fuera de 1 canal y la profundidad publicada quedaba entrelazada por filas; ahora fuerza 1 canal (`extractChannel(0)`).
- **Antes y después** (`capturas/07-profundidad-montanas-antes-despues.jpg`): la primera versión usaba una sola pasada
  sobre la imagen completa. Ahí las montañas ocupaban el 2 % más lejano del rango (la loma y el pingüino se llevaban casi
  todo), a ~0,55 px de modelo por píxel, y con las siluetas de los barcos mezcladas en las laderas. Ahora cada capa
  tiene su rango completo, unas 3 veces más resolución, y se distinguen las crestas y los planos de las laderas.
- **En la página: malla elástica** (`src/backdrop.ts`). Cumbres y laderas son mallas densas
  cuyos **vértices** se corren `parallax × profundidad`. La imagen se estira donde la profundidad salta y **nunca se
  duplica**; el primer intento desplazaba cada píxel en el fragment shader y mostraba dos veces el borde de una ladera.
  Si la malla se pliega, lo cercano tapa a lo lejano. Cuadros de 8 × 6 px (≈ 40 k triángulos entre las dos).
  **Por vértice:** `desplazamiento = movimiento × (mezcla(inicio, fin, curva(contraste(prof) + relieve × relieve local)) + offset) × intensidad + corrimiento`.
  Con la cámara en reposo el movimiento es 0 y el cuadro coincide con la referencia; solo el corrimiento lo cambia.
  **Valores por defecto** (`DEPTH_DEFAULTS` en `src/backdrop.ts`, `DEPTH_PARALLAX_PX` en `src/main.ts`): cumbres con todo el
  rango (0–1), **intensidad 0,2**, contraste 1,4 y **relieve local 2,0** (elegidos por el usuario con el panel el
  16/11/2026): el efecto es más sutil en conjunto y lo domina el volumen propio de cada cresta y falda. El máximo
  general es **34 px en horizontal y 10 en vertical**, escalado por la intensidad de cada capa; laderas casi en bloque (0,2–0,4 del máximo), contraste 1 y relieve 0,15. Además, cada capa está a su
  distancia: al mover la cámara, el pingüino y la loma se desplazan más que
  los barcos, y los barcos más que las montañas (`capturas/08-montanas-parallax.jpg`).
- **Otra salida (documentación):** `profundidad/profundidad-referencia.png` + `.json`, la pasada sobre la imagen
  completa (`npm run depth`). La página ya no la usa.

## Panel de profundidad (DialKit)

`src/panel.ts`: el mismo DialKit que usan los paneles del visor (`dialkit/vanilla`). Se muestra en desarrollo
(`npm run dev`) o con `?panel`, arriba a la derecha.

| Carpeta | Control | Qué hace |
| --- | --- | --- |
| Cumbres / Laderas | Intensidad | Multiplica todo el desplazamiento de la capa. |
| | Inicio / Fin | Tramo de la escala que usa la capa: lo más lejano se mueve «inicio», lo más cercano «fin». |
| | **Offset** | Se suma a la profundidad ya mapeada: corre el pivote. Negativo: lo lejano va en contra del movimiento. |
| | Curva | Exponente de la profundidad (< 1 adelanta los medios tonos, > 1 los atrasa). |
| | Contraste | Separa más lo cercano de lo lejano (alrededor de 0,5). |
| | Relieve | Cuánto pesa el relieve local: volumen propio de cada cresta y falda. |
| | Corrimiento X / Y (px) | Corre la capa también en reposo (cambia el encuadre respecto de la referencia). |
| Movimiento | Profundidad horizontal / vertical (px) | Desplazamiento máximo por profundidad. |
| | Cámara horizontal / vertical (m) | Cuánto se mueve la cámara con el mouse. |
| | Animar | Recorre el rango solo, para ajustar sin mover el mouse (funciona aunque esté activo «reducir movimiento»). |
| — | Restablecer | Vuelve a los valores del código. |

Los valores se guardan en el navegador (`localStorage`, clave `dialkit:hero-montanas`) y sobreviven a la recarga. El
botón de copiar de DialKit pasa los valores al portapapeles; para dejarlos fijos, hay que copiarlos a `DEPTH_DEFAULTS`
(backdrop.ts) y `DEPTH_PARALLAX_PX` / `MOVE` (main.ts). El panel no cambia el costo: los ajustes son uniforms del mismo
shader. Capturas: `capturas/09-montanas-relieve-antes-despues.jpg` (sin relieve local vs. los valores por defecto).

## Loma: terreno generado

`src/terrain.ts` genera la loma en el navegador (≈ 0,3 s: 85 ms el relieve, 70 ms los mapas) con el pipeline de las
islas del laboratorio: `terrain-maps.ts` es la copia de `penguin-lab/src/island/island-maps.ts`, con normales, distancia
a la costa, **sombra del sol horneada** y curvatura. El material es el de nieve y roca del visor. Es geometría 3D de
verdad: se extiende más allá del cuadro, así que al mover la cámara no aparecen bordes, y la **sombra del pingüino cae
sobre la loma en tiempo real** (mapa de sombras del sol, con la animación).

- **Silueta:** para cada columna se toma la primera fila de la capa 07 que es terreno y no pasto, con un cierre
  morfológico de ±18 px para que el pasto sobre la cresta no deje surcos. La cresta va a la distancia del pingüino
  (10,3 m, ±1 m lejos de él), con la altura que la hace coincidir con esa fila desde la cámara.
- **Forma:** detrás de la cresta el terreno baja al mar en 3,2 m (queda oculto por la cresta). Adelante, una pendiente
  suave que sigue la cresta suavizada a lo ancho, con dos octavas de ruido, nunca más alta que la cresta: la silueta no
  cambia.
- **Rocas:** donde la capa 07 pintó roca (máscara proyectada desde la cámara), el terreno sube en bloques redondeados de
  hasta 30 cm. El material pone roca en sus caras inclinadas y deja nieve arriba (bloques nevados). El resto lo decide
  el material por pendiente, como en el visor.
- **Luz:** sol a ~38° desde atrás a la izquierda (`?sol=`). Con el sol a 21° de la primera versión, las laderas que miran
  a la derecha quedaban en sombra y la loma salía mucho más oscura que la referencia.
- **Grilla:** 321 × 321 puntos (5 cm). La malla toma 1 de cada 2 (10 cm, 26 k triángulos, sin los cuadros bajo el agua).
- **Antes y después** (`capturas/06-loma-antes-despues.jpg`): antes la loma era una malla en la grilla de pantalla
  proyectada con la profundidad de Depth Anything. Recortaba la silueta con el alfa de la capa y mostraba el borde de la
  imagen al mover la cámara.

## Cámara (supuestos)

`src/camara.ts`, compartida por los scripts y la página:
- Campo vertical: 30° (lente ~50° horizontales). Es un supuesto: la imagen no trae datos de cámara.
- Horizonte en la fila 499,6: 1,4 px sobre la costa lejana de la capa 04, en la fila 501.
- Altura de la cámara: 4 m sobre el agua. Supuesto: 1,5 m sobre los pies del pingüino, en una loma de 2,5 m. Con eso los
  barcos quedan a 60–800 m y miden 6–23 m.
- En reposo (puntero centrado, sin scroll) el cuadro reproduce la referencia píxel a píxel en sus planos. El mouse mueve
  la cámara ±0,22 m en horizontal y ±0,08 m en vertical, siempre mirando un punto a 40 m. El scroll la sube hasta 0,6 m.
  En pantallas táctiles: arrastre, o una deriva lenta si no se toca. Con `prefers-reduced-motion`, la cámara queda quieta.
- Encuadre «cover»: en pantallas más angostas que 16:9, el recorte se centra en el pingüino (x = 822 px).

## Qué es reconstrucción artística

- **Toda la escena.** Las capas del zip son una ilustración (el `LEEME.txt` del zip aclara que «las zonas ocultas se
  reconstruyeron de forma aproximada»). Si la ilustración fue generada con IA, hay que identificarla así en el sitio.
  En la página hay una nota visible: «Ilustración en capas y escena 3D: reconstrucción artística, no fotografía ni relieve
  medido».
- **No es el canal Beagle medido:** no hay batimetría, costa ni relieve real. Las distancias de los planos (5, 9 y
  20 km) son elecciones.
- **Profundidad de las montañas:** estimación monocular de una ilustración. El parallax está exagerado a propósito.
- **Loma:** terreno generado (procedural), ajustado a la silueta pintada; no es relieve medido. La roca y el pasto salen
  de los colores de la capa pintada; el pasto son recortes de esa capa, porque el material del visor no tiene pasto.
- **Agua:** el color por fila sale del agua pintada; los reflejos de los barcos son reales (reflejo planar). **Decisión:**
  el cielo, las montañas, la loma y el pingüino no se reflejan. Un espejo perfecto pondría las cumbres junto a la orilla,
  y la referencia no las pinta. Las ondas, las estelas y el hielo flotante son procedurales.
- **Pingüino:** el modelo del laboratorio es un pingüino rey (pedido). El de la referencia tiene otras marcas.

## Qué se reutiliza y qué cambia

| Origen | En el hero |
| --- | --- |
| `penguin-lab/src/snow/{shaders,materials,snow-light,snow-volume,terrain-textures,detail-corrected}.ts` + `assets/*.ktx2` | Copiados **sin cambios** a `src/snow/`. En `src/terrain.ts` se inyectan en el shader solo dos cosas: la roca donde la capa pintó roca (en caras inclinadas) y un tinte suave bajo el pasto, más los ajustes de orilla de las islas. Se cambian algunos uniforms de escala (como en las islas) y el tono de la nieve y la roca. |
| `penguin-lab/src/island/island-maps.ts` | Copiado a `src/terrain-maps.ts` sin cambios en los cálculos (solo el tipo del terreno). |
| `penguin-lab/src/king-penguin-colors.ts` | Copiado sin cambios. |
| `penguin-lab/public/assets/models/penguin-custom-smooth.glb` (1,19 MB) | `scripts/pinguino-hero.mjs` (glTF Transform) → `pinguino-hero.glb` (**351 KB, −70 %**): solo «Idle», claves redundantes eliminadas (`resample`), vértices idénticos unidos (`weld`). **Sin cuantizar**: los colores de vértice que lee `king-penguin-colors.ts` no cambian. |
| `terreno-estilizado/src/ocean.ts` | Se reusa su oleaje «sedoso» (`getNoise`) y la idea del reflejo planar. No se usa la costa ni la espuma; el compuesto del agua es nuevo (`src/water.ts`). `waternormals.jpg` (three, 1024², 249 KB) se redujo a 512² WebP (67 KB). |

## Comparación con la referencia

Capturas del canvas en el navegador de la app (`?referencia&dpr=1&quieto`), comparadas con
`node scripts/comparar.mjs <nombre>`:

- `capturas/01-primera-version-lado-a-lado.jpg`: antes (primera versión que corrió).
- `capturas/02-final-lado-a-lado.jpg`: después, misma cámara (loma generada, montañas con malla elástica).
- `capturas/06-loma-antes-despues.jpg`: loma desde Depth Anything vs. loma generada.
- `capturas/07-profundidad-montanas-antes-despues.jpg`: profundidad de las montañas, una pasada vs. una por capa.
- `capturas/08-montanas-parallax.jpg`: montañas con la cámara a la izquierda y a la derecha.
- `capturas/03-final-detalle-pinguino-y-loma.jpg`: detalle.
- `capturas/04-final-parallax-tres-poses.jpg`: mouse a la izquierda, en reposo y a la derecha.
- `capturas/05-final-celular-375x812.jpg`: celular.
- `capturas/final-1672x941.png`: captura final sin comprimir.

Diferencia media por zona (0–255, promedio de |ΔR|, |ΔG|, |ΔB|):

| Zona | Primera versión | Loma desde Depth Anything | Final (loma generada) | Comentario |
| --- | --- | --- | --- | --- |
| Cielo | 1,2 | 1,2 | 1,2 | Capa original (solo recompresión WebP). |
| Montañas y barcos | 1,9 | 1,9 | 1,9 | Mismas capas y posiciones; en reposo el parallax es 0. |
| Agua | 20,9 | 14,5 | 14,6 | El color medio coincide (±3 por canal); difieren la textura de las ondas y las estelas. |
| Loma | 29,3 | 25,1 | 37,0 | Color medio: derecha igual (101/108/128 vs. 96/107/128), centro e izquierda ~13–19 niveles más claros. La diferencia por píxel sube porque las rocas generadas no caen en el mismo píxel que las pintadas; a cambio, es geometría 3D real, sin bordes y con sombras. |
| Pingüino | 35,7 | 29,9 | 32,0 | Otro modelo (pingüino rey 3D vs. el pintado). Posición, tamaño y pose coinciden. |

## Costo medido

**Peso** (`npm run build && node scripts/medir-peso.mjs`; transferencia ≈ gzip en texto, binarios tal cual):

| | |
| --- | --- |
| Escena 3D completa | **≈ 1,79 MB** (JS 217 KB gzip · transcodificador KTX2 527 KB wasm + 15 KB · pingüino 351 KB · máscaras 96 KB · texturas KTX2 224 KB · capas 150 KB · profundidad + relieve de las montañas 108 KB · fuentes 41 KB · resto < 125 KB) |
| Panel de profundidad (DialKit, importación dinámica: solo en desarrollo o con `?panel`) | 53 KB |
| Imagen fija (se ve al instante, LCP y alternativa sin WebGL): captura del render final | 94 KB |
| Total `dist/` | ≈ 2,12 MB transferidos (2,84 MB en disco), contando el panel |

**Rendimiento**, medido en el navegador de la app (Chromium, ANGLE/Direct3D 11) en esta laptop con GPU integrada
**AMD Radeon Graphics** (APU), el 16/11/2026:

| Medición | Resultado |
| --- | --- |
| FPS reales con el mouse moviendo la cámara (`?medir`), 1657 × 942 a dpr 1,25 | **60 FPS** (mediana 16,6–16,7 ms; p95 17,2–18,6 ms), limitado por el refresco de 60 Hz |
| Costo por cuadro (`__heroBench`: render + espera de la GPU, cámara recorriendo todo su rango), 2071 × 1177 px | mediana **10,4–10,8 ms**, p95 11,1–12,3 ms (igual con el relieve local: una lectura de textura más por vértice) |
| Reparto (sacando una parte por vez, 3 repeticiones) | montañas (malla elástica) ≈ 2,3 ms · loma ≈ 2,6 ms · agua (con su pase de reflejo) ≈ 2,3 ms · sombra del pingüino ≈ 1,1 ms |
| Llamadas de dibujo / triángulos por cuadro | 13 / 78 k (loma 26 k; montañas 23 k + 16 k, en cuadros de 8 × 6 px) |
| Historia | Primera versión (loma desde Depth Anything, montañas con desplazamiento por píxel): 10,8 ms y 71 k triángulos. Loma generada: −2,2 ms. Malla elástica de las montañas: +1,7 ms (con cuadros de 4 px eran 118 k triángulos y +2,6 ms, sin diferencia visible). |
| Generación de la loma en el navegador | ≈ 0,3 s (relieve 85 ms, mapas 70 ms, malla y texturas el resto) |
| Escena lista (primer cuadro 3D) en el servidor local | ≈ 0,8 s (sin red real) |
| Vista de celular (375 × 812 emulado, con la GPU de esta laptop) | 60 FPS, sin desborde horizontal |

**Calidad adaptativa:** si la mediana de 120 cuadros pasa de 22 ms, la resolución interna baja 0,25 por paso, hasta
0,75. En pantallas táctiles el máximo es dpr 1,5; en escritorio, 1,75.

**No medido:** un celular real, red lenta y FPS de un equipo sin GPU dedicada que no sea este. La vista de celular se
probó solo en emulación.

## Accesibilidad

- El texto y los enlaces son HTML; el canvas es decorativo (`aria-hidden`) y tiene un enlace para saltar al contenido.
- La imagen fija está debajo del canvas desde el primer momento: la página nunca se ve vacía, y queda sola si no hay
  WebGL 2 o falla la escena (con aviso en `role="status"`).
- Con `prefers-reduced-motion` la cámara no se mueve. Un velo degradado detrás del texto lo mantiene legible sobre las
  cumbres nevadas.
- La comprobación con `?sinwebgl` deja la imagen fija y el aviso.

## Limitaciones y pendientes

- Las rocas generadas no coinciden píxel a píxel con las pintadas (sí en ubicación aproximada): son bloques
  redondeados donde la capa 07 pintó roca. Se ven más nevados y algo más claros que en la referencia.
- La cámara está solo 1,5 m sobre la cresta: el primer plano empieza a ~8 m. En la referencia, las rocas de abajo se ven
  más cerca y más grandes.
- El agua no tiene el dorado cálido de las estelas pintadas, solo su forma y brillo.
- El transcodificador KTX2 (527 KB) es el mayor recurso. Pasar las tres texturas del material a WebP lo evitaría, pero
  dejaría de compartir el formato con el visor. Queda como propuesta.
- El shader de la loma sigue siendo lo más caro (≈ 2,6 ms en esta GPU). En un celular de gama media hay que medir. Si no
  llega a 30 FPS, la calidad adaptativa baja la resolución, pero no simplifica el material.

## Licencias y atribuciones

- Depth Anything V2 Small: Apache-2.0 (Yang et al., 2024).
- Pingüino: Polyfork, CC BY 4.0 (`public/LICENSES/CC-BY-4.0.txt`).
- Texturas de roca y nieve: Poly Haven «Marble Cliff 04» y ambientCG «Snow007A», CC0 (`src/snow/assets/texturas.json`).
- Geist (Vercel) e IBM Plex Mono (IBM): SIL OFL 1.1, servidas desde el sitio con @fontsource
  (`public/LICENSES/OFL-1.1-Geist.txt`, `public/LICENSES/OFL-1.1-IBM-Plex-Mono.txt`).
- three.js: MIT (`public/LICENSES/THREE.txt`), incluido `Water` y `waternormals.jpg`.
- Capas de la ilustración: zip entregado por el equipo (`fuente/LEEME.txt`). Falta documentar su autoría y si se generó
  con IA antes de publicarla.
