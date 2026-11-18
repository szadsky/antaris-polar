# Antaris Polar

**Explorá la Antártida. Descubrí su ciencia.**

Plataforma web educativa e inmersiva desarrollada para **SoberaníaTech 2026**, Eje 02: **Antártida, Ciencia y Conocimiento Abierto**. Acerca la ciencia antártica a estudiantes, docentes y público general, con especial atención a su relación con Tierra del Fuego y al territorio bicontinental.

El proyecto responde a un problema: la información científica existe, pero está dispersa y puede ser difícil de interpretar sin conocimientos previos. Antaris Polar combina exploración visual, contenidos breves, actividades y enlaces a fuentes originales para hacerla más accesible. El prototipo ya integra navegación 3D, fichas de bases, noticias, investigaciones y una trivia educativa.

[Visitar el sitio](https://antaris-polar.vercel.app/) · Documentación actualizada: **18 de noviembre de 2026**.

## Equipo

| Integrante | Rol y formación |
|---|---|
| **David Szadorski** · referente | Diseño · Estudiante de 4.º año de Ingeniería Industrial · Visual designer en basement.studio |
| **Clara Juan** | Diseño · Estudiante de 5.º año de Ingeniería Industrial |
| **Karen Juan** | Diseño · Estudiante de 2.º año de Diseño Multimedial |

## Secciones del sitio

| Sección | Ruta | Qué ofrece |
|---|---|---|
| **Home** | `/` | Hero ilustrado con parallax, narrativa al hacer scroll, huellas progresivas y sonido de pasos. Widget meteorológico para Ushuaia y las bases. |
| **Explorar el terreno** | Dentro del home | Recorrido con un pingüino por un escenario 3D que conecta las secciones. Se adapta al viewport, con controles táctiles y acceso a sitios próximos en móvil. |
| **Bases antárticas** | `/descubrir/` | Visor de las 13 bases argentinas, relieve derivado de REMA, edificios estilizados y fichas con descripción, historia cuando está disponible y fuentes. El bloque **Ubicación** muestra un mapa SVG con un único pin, coordenadas IGN y costa SCAR/BAS en EPSG:3031. |
| **Noticias** | `/noticias/` | Selección editorial de notas reales, con resumen propio, fecha, organismo, categoría y tema —por ejemplo, glaciología o biodiversidad—. Cada card enlaza al artículo original. |
| **Investigaciones** | `/investigaciones/` | Noticias antárticas de CONICET/CADIC y listado de papers con autores, revista, año y DOI. |
| **AntarisPlay** | `/antarisplay/` | Trivia «Rumbo a la Antártida»: cinco niveles desde Ushuaia hacia la Antártida, con explicaciones de las respuestas. |

Las rutas de experimentación se conservan en `/exploraciones/`: home, bases, pingüino y terrenos con parámetros editables. También están disponibles `/laboratorio/pinguino/` y `/pinguino-menu/`. Los paneles de parámetros no forman parte de la presentación pública normal.

### Interacción y accesibilidad

El sitio combina navegación HTML con escenas WebGL. Incluye enlaces directos a las secciones, foco visible, cards semánticas, adaptación responsive y tratamiento de movimiento reducido en el home. El hero dispone de imagen de respaldo si falla WebGL. El explorador incorpora joystick táctil; las cámaras admiten arrastre, zoom y gestos de dos dedos. Las coordenadas también se presentan como texto, sin depender del mapa.

Estas medidas no equivalen a una certificación de accesibilidad: quedan pendientes una auditoría completa y más pruebas en dispositivos físicos.

## Tecnologías y herramientas

| Área | Implementación |
|---|---|
| **Web** | HTML, CSS y TypeScript; JavaScript modular, DOM y SVG. Las experiencias principales no requieren un framework de interfaz. |
| **Gráficos 3D** | Three.js, WebGL y shaders GLSL; modelos glTF/GLB, materiales de nieve, roca, hielo y agua, animación del pingüino y huellas. |
| **Rendimiento** | Terreno por bloques y niveles de detalle (LOD), calidad adaptativa, texturas KTX2/Basis, recursos WebP y carga de datos de la base activa. |
| **Interacción** | Pointer Events, controles de cámara de Three.js, Web Audio API para pasos, orientación del dispositivo para parallax móvil cuando está disponible y `postMessage` para integrar el explorador. |
| **Controles y tipografía** | DialKit para controles y dropdowns; Geist, Geist Mono e IBM Plex Mono mediante Fontsource. |
| **Compilación** | Node.js, npm, TypeScript y Vite. Scripts propios ensamblan las experiencias en un sitio estático. |
| **Datos geográficos** | GeoTIFF.js y proj4 en el pipeline; datos GeoTIFF, GeoJSON y JSON. Proyección polar sur EPSG:3031. El localizador SVG no incorpora una librería de mapas. |
| **Preparación de geometría y recursos** | meshoptimizer, earcut, polygon-clipping, clipper-lib, ktx2-encoder, glTF Transform y sharp; SunCalc para cálculos solares del visor. |
| **Procesamiento con IA** | Depth Anything V2 Small con Transformers.js / Hugging Face y ONNX Runtime, ejecutado offline para estimar profundidad visual. |
| **Trivia** | HTML, JavaScript, jQuery y toastr en la experiencia existente. |
| **Diseño y prototipado** | Figma para diseño de interfaces, prototipado web y referencias de composición; adaptación al sistema visual de Antaris Polar. |
| **Desarrollo asistido y colaboración** | Codex para implementación, revisión y verificación; contexto y reglas de trabajo para Claude Code en el repositorio. Git y GitHub para versionado; configuración de despliegue en Vercel. |

Las versiones y dependencias de cada módulo se encuentran en sus `package.json` y `package-lock.json`. Las herramientas de procesamiento offline no se ejecutan todas en el navegador.

## Uso de inteligencia artificial

**La IA se utilizó como apoyo para la implementación, bajo un conocimiento sólido de las tecnologías utilizadas y del diseño, con dirección y criterio del equipo.** Las decisiones de producto, la experiencia de usuario y la dirección visual son responsabilidad del equipo; la asistencia de IA ayuda a convertirlas en código, iterar componentes, resolver problemas y verificar cambios.

Se distinguen dos usos:

- **Asistencia al desarrollo:** implementación de interfaces y escenas, refactorización, depuración, preparación de datos, documentación y apoyo a las comprobaciones técnicas. El trabajo se contrasta con el código, las fuentes y el comportamiento del sitio.
- **Estimación de profundidad:** [Depth Anything V2 Small](https://depth-anything-v2.github.io/) estima profundidad relativa a partir de las capas ilustradas del hero. Los resultados se preparan offline para el parallax; no son mediciones topográficas ni distancias científicas.

El sitio no integra un chatbot ni genera noticias o papers para visitantes. Los contenidos se guardan en archivos editables y remiten a fuentes originales. La procedencia y autoría de la ilustración base del hero aún requieren completar su documentación; no se atribuye su generación a una herramienta de IA sin evidencia.

## Fuentes, datos y rigor geográfico

| Fuente | Uso concreto en el proyecto |
|---|---|
| [IGN · Tabla de bases antárticas](https://www.ign.gob.ar/NuestrasActividades/Geografia/DatosArgentina/BasesAntartida) y [Atlas de la Antártida Argentina](https://antartida-anida.ign.gob.ar/mapstore/) | Coordenadas oficiales, información geográfica y referencias de las fichas. |
| [Polar Geospatial Center · REMA](https://www.pgc.umn.edu/data/rema/) | Modelo de elevación de origen para los terrenos de las bases. Se usa REMA Mosaics v2.0 y recortes preparados para la web. |
| [SCAR Antarctic Digital Database / British Antarctic Survey](https://www.bas.ac.uk/project/add/) | Costa antártica; datos v7.12 existentes en el repo, simplificados para visualización. Costa y pin del localizador comparten EPSG:3031. |
| [SCAR Composite Gazetteer of Antarctica](https://placenames.aq/) | Topónimos y puntos de referencia del pipeline geográfico. |
| [COMNAP · Antarctic Facilities](https://www.comnap.aq/antarctic-facilities-information) | Catálogo de instalaciones de noviembre de 2024 y referencias de origen del terreno. El pin del nuevo bloque Ubicación utiliza IGN, no el centro del terreno. |
| [Australian Antarctic Data Centre · Our Footprint on Antarctica](https://doi.org/10.26179/5dc8db48eb58e) | Contornos históricos de edificios y áreas intervenidas. Las alturas y techos 3D son aproximaciones gráficas. |
| [GeographicLib · GeoidEval](https://geographiclib.sourceforge.io/cgi-bin/GeoidEval) | Referencias de geoide EGM2008/EGM96 para el tratamiento de alturas. |
| [MET Norway · Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/documentation) | Pronóstico horario para las coordenadas de Ushuaia y de cada base; temperatura, viento y estado del tiempo. |
| [Crossref](https://www.crossref.org/) | Metadatos bibliográficos de los papers: autores, revista, año y DOI; enlaces individuales conservados en el JSON. |

El widget muestra **pronósticos**, no observaciones de estaciones en tiempo real. La rotación de base cada 10 segundos cambia el lugar mostrado; no implica una actualización meteorológica cada 10 segundos. Las respuestas se almacenan temporalmente durante tres horas.

El relieve de las bases procede de datos geográficos, pero su material, iluminación, detalle visual y edificios están estilizados. El hero y las islas del pingüino son composiciones artísticas o terrenos procedurales: **no son topografía medida**. La resolución de la fuente REMA no equivale a la resolución de todas las mallas renderizadas.

### Fuentes editoriales

Las notas publicadas enlazan al artículo individual y conservan fecha, organismo y, cuando corresponde, URL del estudio. La selección actual incluye **CONICET, CADIC-CONICET, Armada Argentina, Australian Antarctic Program y NSIDC**. British Antarctic Survey también forma parte de las fuentes autorizadas para futuras selecciones.

- [CONICET · Antártida](https://www.conicet.gov.ar/tag/antartida/).
- [CADIC-CONICET · Antártida](https://cadic.conicet.gov.ar/tag/antartida/).
- [Armada Argentina · Noticias](https://www.argentina.gob.ar/defensa/armada/noticias).
- [Australian Antarctic Program · News](https://www.antarctica.gov.au/news/).
- [NSIDC · Sea Ice Today](https://nsidc.org/sea-ice-today/analyses).
- [British Antarctic Survey · News](https://www.bas.ac.uk/news/).

Los resúmenes son propios; una proyección o simulación no se presenta como observación. No hay scraping en el navegador ni base de datos de noticias. Las fotografías requieren permiso y crédito; cuando no están documentados se usa una imagen de respaldo.

### Bibliografía seleccionada

- **Howat, I. et al. (2022).** *The Reference Elevation Model of Antarctica – Mosaics, Version 2*. Harvard Dataverse. [DOI: 10.7910/DVN/EBW8UC](https://doi.org/10.7910/DVN/EBW8UC).
- **SCAR Antarctic Digital Database (2025).** Costa antártica, versión utilizada v7.12. [Referencia del conjunto de datos](https://doi.org/qc9x).
- **Santos, N. A. et al. (2025).** *Cosmic Ray Counting Variability From Water‐Cherenkov Detectors as a Proxy of Stratospheric Conditions in Antarctica*. Earth and Space Science. [DOI: 10.1029/2025EA004298](https://doi.org/10.1029/2025EA004298).
- **Antoni, J. S. et al. (2024).** *Long‐term studies on West Antarctic Peninsula phytoplankton blooms suggest range shifts between temperate and polar species*. Global Change Biology. [DOI: 10.1111/gcb.17238](https://doi.org/10.1111/gcb.17238).
- **Krock, B. et al. (2020).** *Detection of the phycotoxin pectenotoxin-2 in waters around King George Island, Antarctica*. Polar Biology. [DOI: 10.1007/s00300-020-02628-z](https://doi.org/10.1007/s00300-020-02628-z).
- **Yang, L. et al. (2024).** *Depth Anything V2*. NeurIPS 2024. [Publicación y código](https://depth-anything-v2.github.io/).

## Licencias y atribuciones

Las licencias se aplican a cada recurso por separado. La disponibilidad pública del repositorio no cambia las condiciones de los datos, fotografías, modelos o dependencias.

| Recurso | Licencia / atribución |
|---|---|
| REMA v2.0 | CC BY 4.0; citar PGC y el conjunto de datos de Howat et al. |
| Costa SCAR ADD | CC BY 4.0; citar SCAR ADD / BAS y la versión empleada. |
| Edificios de AADC | CC BY 4.0; conservar el DOI y la referencia histórica del conjunto. |
| Pronóstico MET Norway | CC BY 4.0 / NLOD 2.0, según su [política de datos](https://api.met.no/doc/License); atribución visible en el widget. |
| COMNAP Facilities 2024 | Uso educativo y no comercial según las condiciones registradas con el dataset; citar «COMNAP 2024». |
| Coordenadas y contenidos IGN | Fuente oficial atribuida; este proyecto no les asigna una licencia propia. Consultar condiciones del organismo para redistribución. |
| Fotos de noticias | Licencia individual en `noticias.json`: entre las utilizadas, CC BY 4.0 y CC BY 2.5 AR. Se conservan autor/crédito, original y URL del permiso. Los artículos y papers conservan sus derechos originales. |
| [Pingüino de Polyfork](https://polyfork.dev/asset/penguin-base) | CC BY 4.0; modelo adaptado para las experiencias. |
| [Deformación de terreno de Oguzhan Tufenk / Codrops](https://github.com/oguzhantufenk/dynamic-terrain-deformation) | MIT; adaptación para las huellas, con licencia en `exploraciones/penguin-lab/src/vendor/deformation/`. |
| Código Noxe de Daniel Jankulovski | MIT; licencia conservada en `exploraciones/terreno-estilizado/src/vendor/noxe/`. |
| [Poly Haven · Marble Cliff 04](https://polyhaven.com/a/marble_cliff_04), Amal Kumar | CC0 1.0; textura de roca. |
| [ambientCG · Snow007A](https://ambientcg.com/view?id=Snow007A) | CC0 1.0; microrelieve de nieve. |
| Geist, Geist Mono e IBM Plex Mono | SIL Open Font License 1.1. |
| Depth Anything V2 **Small** | Apache-2.0. No se usan los modelos Base/Large con condiciones diferentes. |
| Three.js, Vite, DialKit, proj4, GeoTIFF.js, meshoptimizer, glTF Transform, polygon-clipping y ktx2-encoder | MIT, según los paquetes instalados. |
| TypeScript, Transformers.js y sharp | Apache-2.0, según los paquetes instalados. |
| earcut / clipper-lib | ISC / Boost Software License, respectivamente. Conservar los textos de licencia de las dependencias y componentes transitivos. |

Los avisos adicionales acompañan los recursos en las carpetas `public/LICENSES/`, los directorios `vendor/` y los paquetes instalados. **El código propio aún no tiene una licencia general declarada en un archivo LICENSE en la raíz.** La autoría y el permiso de reutilización de las capas ilustradas del hero también están pendientes de documentar; no quedan cubiertos por las licencias de las texturas o del modelo del pingüino.

## Ejecutar el proyecto

Requisito: **Node.js 22.7 o posterior** y npm.

```bash
npm run setup
npm run build
npm run preview
```

Abrir [la vista previa local](http://127.0.0.1:3410/). La compilación genera el sitio completo en `dist/`; no requiere reescrituras SPA. Para desarrollar una experiencia individual:

```bash
cd exploraciones/hero
npm ci
npm run dev
```

El hero usa el puerto 3420, el visor 3400 y el laboratorio 3402. `npm run setup` omite las herramientas offline del hero; para regenerar profundidad o procesar sus recursos, instalar también sus dependencias de desarrollo con `npm ci` dentro de esa carpeta.

Pruebas del pingüino desde la raíz:

```bash
npm run test:penguin
```

Incluyen movimiento, marcha, huellas, deslizamiento, sonido, nieve, caídas y controles táctiles. `npm run build` comprueba TypeScript y compila los módulos. Las comprobaciones geográficas y de edificios se documentan en los respectivos pipelines.

### Estructura y edición de contenidos

```text
exploraciones/hero/                Home, noticias, investigaciones y clima
exploraciones/terreno-estilizado/   Visor actual y fichas de bases
exploraciones/terreno-nitidez/     Recursos geográficos compartidos del visor
exploraciones/terreno-bases/       Exploración cartográfica y costa preparada
exploraciones/penguin-lab/         Pingüino, islas y controles
exploraciones/trivia-antartida/    AntarisPlay
compartido/                        Navegación y modo público/exploración
pipeline/rema/                    Obtención y comprobación del relieve
scripts/                          Preparación, compilación y ensamblado
data/                             Datos, metadatos y controles geográficos
```

- [Noticias](exploraciones/hero/src/secciones/noticias.json): notas, temas, fechas, fuentes, imágenes y permisos.
- [Investigaciones](exploraciones/hero/src/secciones/investigaciones.json): noticias y bibliografía con DOI.
- [Catálogo de bases](exploraciones/terreno-nitidez/public/terreno/index.json): fichas y coordenadas oficiales.
- [Lugares del clima](exploraciones/hero/src/weather-locations.json): coordenadas consultadas por el widget.
- [Pipeline REMA](pipeline/rema/README.md), [edificios](data/buildings/README.md), [hero](exploraciones/hero/README.md) y [laboratorio](exploraciones/penguin-lab/LEEME.txt): documentación técnica de cada experiencia. Algunos documentos conservan mediciones y decisiones de etapas anteriores.

Los GeoTIFF REMA crudos no se versionan; su obtención y verificación se documentan en `pipeline/rema/`, con metadatos y hashes en `data/rema/`.

### Publicación

La configuración de Vercel en `exploraciones/terreno-estilizado/vercel.json` instala y compila desde la raíz del repositorio y publica el ensamblado completo. También se puede alojar el contenido de `dist/` en un servidor estático. Compilar localmente no publica el sitio por sí solo.

## Próximos pasos

Ampliar contenidos de biodiversidad y actividades educativas, evaluar la experiencia con estudiantes y docentes, profundizar las pruebas de accesibilidad y rendimiento en celulares reales, y completar los créditos y la licencia del código propio. Estas líneas son trabajo futuro, no secciones ya implementadas.
