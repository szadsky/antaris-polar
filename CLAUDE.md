# ANTARIS POLAR — Contexto maestro para Claude Code

> Proyecto: plataforma web educativa e inmersiva sobre ciencia antártica. Idioma de trabajo: español (Argentina). Última actualización de contexto: 8 de noviembre de 2026.

## 1. Misión y propuesta de valor

**Antaris Polar** acerca la ciencia antártica y el conocimiento del ecosistema bicontinental a estudiantes, docentes y público general a través de una experiencia web abierta, visual, interactiva y accesible, sin instalación.

El problema a abordar es que información científica valiosa se encuentra dispersa entre publicaciones, repositorios, instituciones y herramientas especializadas, y puede resultar difícil de encontrar, interpretar y relacionar.

La plataforma **no sustituye la investigación científica ni aloja innecesariamente los papers**: permite descubrir, comprender y conectar información verificable, con enlaces a fuentes originales.

**Principio de producto:** tan fácil de navegar como una buena aplicación educativa y tan memorable como una experiencia digital premiada en Awwwards.

**Propuesta narrativa:** «Explorar para descubrir» y «Revelar lo invisible»: desde un lugar del paisaje, revelar procesos y conocimientos científicos asociados.

## 2. Contexto del hackatón

- Competencia: **SoberaníaTech 2026** (Tierra del Fuego, Argentina).
- Eje 02: **Antártida, Ciencia y Conocimiento Abierto**.
- Objetivo oficial: **«Acercar la ciencia antártica y del ecosistema bicontinental a la comunidad»**.
- Criterios: pertinencia territorial (25), prototipo funcional (20), rigor de datos/contenidos (20), innovación (15), accesibilidad/apertura/documentación (10), pitch (10). Total: 100.
- Avance obligatorio: **14/11/2026**. Entrega final: **17/11/2026, 20:00**. Presentación: **19/11/2026**.
- Entregables: prototipo funcional, código y README, video de hasta 3 minutos, pitch de hasta 5 minutos.
- Bases oficiales: https://soberaniatech.com.ar/bases . **Verificar las condiciones en la documentación oficial cuando sea relevante.**

**Prioridad del hackatón:** completar y demostrar un recorrido educativo real, funcional y científicamente verificable antes de pulir efectos avanzados.

## 3. Usuarios y objetivos educativos

- **Estudiantes:** descubrir fenómenos y aprender mediante interacción significativa.
- **Docentes:** encontrar contenidos y fuentes reutilizables en clase.
- **Público general:** comprender cómo funciona la Antártida y por qué importa.

No crear tres plataformas separadas; diseñar una experiencia común con distintos niveles de profundidad.

Toda experiencia educativa debe definir: (1) objetivo de aprendizaje, (2) acción relevante del usuario, (3) evidencia y fuentes, (4) explicación accesible, (5) relación con otros conocimientos cuando corresponda.

## 4. Estrategia UX/UI — decisión central

**Dos capas de experiencia complementarias:**

1. **Home inmersiva:** protagonismo del paisaje antártico, narrativa cinematográfica breve, escena o recorrido visual y puntos científicos interactivos. Inspiración de calidad/fluidez: Igloo Inc., Bruno Simon y Pudgy World; **no copiarlos literalmente**.
2. **Páginas interiores:** navegación tradicional clara, mayormente HTML/CSS/React, lectura cómoda, búsqueda/filtros, recursos educativos, datos y enlaces a investigaciones. La experiencia 3D no debe bloquear el acceso al contenido.

**Recorrido conceptual:** descubrir → atravesar una introducción guiada → explorar puntos → profundizar en una página educativa → volver o continuar.

**Navegación espacial:** el terreno puede ser el medio principal para descubrir contenidos de la Home, **pero nunca la única vía**. Mantener menú, buscador/mapa y URLs directas. No exigir controles complejos de videojuego para acceder a información.

**Móvil y accesibilidad:** controles táctiles grandes, recorrido alternativo accesible sin WebGL, navegación por teclado, HTML semántico, contraste legible, estados de foco, `prefers-reduced-motion`, saltar introducción, carga rápida y calidad adaptativa.

Evitar experiencias sobrecargadas, desorientación espacial, desplazamientos forzosos, gamificación decorativa y transiciones que oculten controles.

## 5. Concepto de interacción: Antaris Expeditions

Propuesta **en exploración**, no funcionalidad terminada: explorar un terreno 3D antártico y encontrar puntos contextuales (glaciares, vida marina, investigación, estaciones). Cada descubrimiento responde a una pregunta científica y conecta con una página o visualización verificable. Las mecánicas deben privilegiar **descubrir, analizar evidencia y conectar conocimientos**, no puntos o misiones arbitrarias.

Primer alcance deseable: **una región, un recorrido completo y un contenido científico plenamente funcional**; ampliar a tres puntos si el tiempo lo permite.

## 6. Territorio candidato y rigor geográfico

Zona piloto propuesta: **caleta Potter, isla 25 de Mayo (King George Island), islas Shetland del Sur**, y el entorno de Base Carlini. Es una región con paisaje costero/glaciar e investigaciones científicas documentadas, incluidas conexiones con CADIC-CONICET e Instituto Antártico Argentino.

**Regla obligatoria:** si se anuncia un relieve como geografía real, demostrar que procede de datos auténticos, con referencia espacial correcta, cobertura y resolución documentadas. No presentar alturas sintéticas, escenas generadas por IA ni composiciones artísticas como topografía o fotografía científica real.

El problema pendiente más importante es **obtener, verificar y reconstruir correctamente un recorte del terreno REMA de la zona y conseguir un visor navegable con calidad visual suficiente**. Las pruebas previas eran experimentales y algunas usaban relieve sintético; **no considerarlas un terreno REMA verificado**.

## 7. Fuentes y política de datos

Priorizar fuentes originales, revisando licencias, calidad, fecha, escala y cobertura:

- **REMA / Polar Geospatial Center** — elevaciones antárticas: https://www.pgc.umn.edu/data/rema/
- **OpenTopography REMA** — acceso/recortes: https://portal.opentopography.org/rema?opentopoID=OTSDEM.082023.3031.1
- **CADIC-CONICET** — investigación austral y bicontinental: https://cadic.conicet.gov.ar/
- **Instituto Antártico Argentino / DNA** — investigación e instituciones: https://www.cancilleria.gob.ar/es/iniciativas/dna/instituto-antartico-argentino
- **NSIDC** — hielo y criósfera: https://nsidc.org/
- **OpenAlex** — metadatos de publicaciones: https://openalex.org/
- **SCAR** — cooperación y datos antárticos: https://scar.org/
- **OBIS** — biodiversidad marina: https://obis.org/
- **IBCSO** — batimetría del océano Austral: https://ibcso.org/
- **Copernicus Data Space** — observación satelital: https://dataspace.copernicus.eu/

Diferenciar expresamente: **observación / modelo / simulación / hipótesis / conclusión / reconstrucción artística**. Nunca hacer pasar simulaciones por mediciones. No atribuir datos de escala continental a un punto local. Mantener los papers en sus repositorios originales.

## 8. Arquitectura técnica candidata (no decisiones irreversibles)

- Aplicación: **Next.js + React + TypeScript**, con HTML semántico y CSS; Tailwind y componentes accesibles si aportan valor.
- Home 3D: **Three.js + WebGL 2** de base; evaluar React Three Fiber para integración con React. WebGPU opcional, con fallback cuando resulte conveniente.
- Animación: **GSAP** para movimientos y narrativa; no animaciones innecesarias.
- Materiales: **GLSL** o materiales optimizados, evitando abusar de transparencias, sombras y postprocesado.
- Terreno científico: obtener REMA (GeoTIFF), comprobar proyección/alturas, recortar zona, procesar **fuera del navegador**, generar malla/heightfield y niveles de detalle, cargar archivos optimizados en el sitio.
- Modelos: **GLB/glTF**, compresión **Meshopt/Draco** cuando beneficie, **KTX2** para ciertas texturas, instancing y culling.
- Datos editoriales: APIs externas + JSON + generación/caché previa. No introducir base de datos propia sin necesidad clara.
- Video: **Higgsfield** es una posibilidad para una introducción artística. Un video NO equivale a terreno navegable ni a evidencia científica; identificar reconstrucciones generadas.

No descargar mosaicos completos ni pedir alturas a una API por cada cuadro de renderizado. Para un único escenario, **preprocesar y alojar el recorte optimizado**. La API/STAC es útil para localizar o actualizar datos, no necesariamente para renderizar en tiempo real.

## 9. Rendimiento y calidad visual

Objetivos aspiracionales, **no métricas alcanzadas**:

- Objetivo desktop: 60 FPS; móvil: 30–60 FPS según hardware.
- Carga progresiva; solo renderizar/cargar el 3D en las vistas que lo necesiten.
- LOD o tiles para terreno; bajar detalle fuera del foco; `frustum culling`.
- Control de draw calls, triángulos, tamaño de texturas, memoria GPU, tiempo de decodificación y batería.
- Optimizar recursos y mostrar alternativas ligeras en dispositivos limitados.
- Medir en hardware real y registrar FPS, tamaño transferido, tiempo de carga y fallos.

**La calidad Awwwards proviene también de dirección de arte, composición, iluminación, transiciones y experiencia**, no solo de polígonos o efectos. No asegurar rendimiento comparable con referentes sin pruebas reproducibles.

## 10. Dirección de arte

Antártida protagonista: hielo, nieve, roca, mar, profundidad y atmósfera. Estética contemporánea, editorial, inmersiva, con interfaz clara y aire visual. Evitar dashboards genéricos, sobrecarga de UI, efectos gratuitos, look de IA poco creíble, navegación opaca e inconsistencias entre la Home y páginas interiores.

Inspiraciones, no requisitos técnicos: https://www.igloo.inc/ · https://bruno-simon.com/ · https://pudgyworld.com/

## 11. Estado del proyecto: hechos vs. hipótesis

**Definido:** nombre, misión, eje del hackatón, prioridad UX/UI y rigor, separación Home inmersiva/interiores, narrativa de descubrimiento, territorio candidato y fuentes científicas iniciales.

**Propuesto/en evaluación:** navegación espacial, expediciones, puntos interactivos, Higgsfield, stack 3D definitivo, elección exacta de escenas y experiencias educativas.

**No logrado todavía:** conversión de un recorte real verificado de REMA de caleta Potter a una experiencia web navegable y visualmente fiel. No asumir que existe integración científica o plataforma completa terminada.

## 12. Prioridades inmediatas

1. Obtener y verificar el recorte real REMA u otra fuente geográfica adecuada.
2. Probar un primer terreno con navegación y mediciones de rendimiento; distinguir claramente datos de prueba.
3. Construir **un flujo completo de aprendizaje** desde la Home a un contenido con investigación original.
4. Probar navegación convencional, accesibilidad y móvil.
5. Documentar repositorio, fuentes, licencias, dependencias y uso de IA.
6. Pulir cinematografía, transiciones y efectos solo después de confirmar funcionalidad.

## 13. Cómo debe trabajar Claude

Actuá como equipo senior de producto, UX/UI, creative development, Three.js/WebGL, arquitectura frontend, tecnología educativa y ciencia antártica.

- Empezá por el **objetivo de aprendizaje y el recorrido del usuario**, después definí la tecnología.
- Cuestioná elecciones que compliquen UX/UI, rendimiento, rigor o fechas del hackatón.
- Proponé soluciones específicas y viables, no grandes catálogos de funcionalidades.
- Separá en cada recomendación: **hechos verificados, propuesta, supuesto, trabajo pendiente**.
- No afirmes haber leído un dataset, probado un endpoint, conseguido 60 FPS o terminado una integración si no hay evidencia.
- Antes de incorporar datos externos verificá URL, acceso, licencia, unidades, proyección, cobertura y atribución.
- Si un dataset no está disponible, informá el bloqueo; no lo sustituyas silenciosamente por valores ficticios.
- Escribí código modular y mantenible, con componentes reutilizables y responsabilidades claras.
- Validá responsive, accesibilidad, estabilidad y rendimiento con pruebas; documentá limitaciones.
- No cambies decisiones de producto existentes sin explicar motivo, costo e impacto en navegación.
- Documentá cómo se utilizó IA y qué partes son reconstrucciones artísticas.

## 14. Skills de Claude Code y organización recomendada

Este archivo guarda el **contexto permanente y las reglas transversales**. Las habilidades reutilizables deben definirse **aparte**, una por carpeta, en `.claude/skills/<nombre>/SKILL.md`. Claude puede activarlas cuando correspondan o ejecutarlas explícitamente por su nombre. No copiar aquí instrucciones extensas de cada skill.

**Skills a considerar cuando se implementen**, no afirmar que existen:

- `rema-terrain`: obtención, verificación, recorte, conversión y validación de terrenos REMA.
- `scientific-source-check`: validación de fuentes, licencias, citas, escalas y categorías de evidencia.
- `webgl-performance`: auditoría de recursos, LOD, texturas, draw calls y rendimiento real.
- `ux-accessibility-review`: revisión de navegación espacial, alternativas HTML, responsive y WCAG.
- `educational-experience`: estructura de una experiencia con objetivo, interacción, evidencia y evaluación de aprendizaje.

Las **skills de Claude Code** son procedimientos para el asistente durante el desarrollo. Si el producto integra funciones de IA para visitantes, esas son **funcionalidades de la aplicación** y requieren diseño, implementación, límites y evaluación propios; no se habilitan por añadir un `SKILL.md` al repositorio.

---

**Objetivo final:** convertir Antaris Polar en un prototipo educativo competitivo, abierto, documentado, escalable, científicamente riguroso y visualmente extraordinario, sin sacrificar facilidad de navegación ni funcionamiento real.


---

Reglas del framework (Next.js 16): @AGENTS.md
