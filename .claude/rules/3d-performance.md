# Antaris Polar — Reglas de terreno 3D y rendimiento web

> Guardar como `.claude/rules/3d-performance.md` dentro del repositorio.
> Este documento complementa `CLAUDE.md`; **no** lo reemplaza.

## Objetivo

Desarrollar una experiencia antártica tridimensional navegable y visualmente cuidada, con rendimiento adecuado en navegadores modernos, incluyendo móviles de gama media. La calidad debe provenir de la composición, iluminación, materiales y gestión de recursos, no de añadir geometría o efectos indiscriminadamente.

El terreno representa geografía científica. **No presentar geometría procedimental ficticia como REMA ni afirmar que un recurso es georreferenciado sin validarlo.**

## Referencias técnicas (estudiar; no copiar ciegamente)

1. **Basement Studio / website-2k25** — https://github.com/basementstudio/website-2k25
   - Caso de estudio: https://basement.studio/post/new-digital-hq-pt-1
   - Analizar su uso de low-poly, texturas comprimidas, lightmaps/AO precalculado, shaders compartidos, instancing y navegación point-and-click.
   - Revisar los scripts y arquitectura del repositorio, sin asumir que todos los patrones son adecuados para terreno geoespacial.
2. **JOYCO / Chopper** — https://github.com/joyco-studio/chopper
   - Evaluar sus capacidades y mantenimiento actuales antes de instalar. Comparar contra glTF Transform; no añadir dependencias redundantes.
3. **Igloo Inc. (Abeto)** — https://www.igloo.inc/
   - Referencia de dirección artística, efectos en GPU y experiencia cinematográfica; no asumir que conocemos su código de producción ni sus cifras de rendimiento.
4. **glTF Transform** — https://gltf-transform.dev/
   - Preferir operaciones reproducibles y medibles: inspección, limpieza de recursos, simplificación, compresión Meshopt/Draco, análisis de texturas.

Comprobar licencias y autoría antes de reutilizar código o assets de terceros.

## Fuente del terreno: REMA

- Usar archivos auténticos del Polar Geospatial Center u OpenTopography para la región de caleta Potter / Base Carlini.
- Verificar **cobertura, EPSG:3031, datum vertical, unidades, celdas NoData, resolución y procedencia** antes de convertir.
- Recortar fuera del navegador y conservar el GeoTIFF original como fuente. No pedir miles de elevaciones individuales por cuadro ni descargar DEMs continentales en la Home.
- Transformar la superficie en `heightfield` o malla optimizada conservando escala horizontal y vertical: 1 m de elevación = 1 m real, salvo exageración vertical explícitamente identificada.
- No inferir una costa precisa a partir del DEM solamente: combinar con cartografía validada y tratar los vacíos como NoData, no como elevación cero.
- Si no están disponibles los datos reales, documentar el bloqueo; la demo sintética, si existiera, debe estar visiblemente etiquetada y no presentarse como terreno antártico real.

## Pipeline de assets (fuera del navegador)

1. **Inspeccionar** fuente geoespacial y calcular límites, alturas, resolución, cobertura y NoData.
2. **Recortar** la región realmente visitable; evitar un único modelo gigante.
3. **Generar tiles/LOD** con bordes coherentes entre niveles para evitar grietas o saltos visibles.
4. **Simplificar** mallas según distancia, error geométrico y ángulo de cámara; conservar perfiles reconocibles de montañas y costas.
5. **Optimizar** representaciones: compararlas entre `heightfield` binario y GLB; escoger por rendimiento real, no por preferencia tecnológica.
6. **Comprimir** geometría (Meshopt o Draco cuando convenga) y usar KTX2/Basis Universal para texturas que realmente lo justifiquen.
7. **Versionar recursos** derivados y generar un manifiesto con ubicación, resolución, LOD, tamaños, hash y atribución de datos.
8. **Validar visualmente** el antes/después de cada optimización, comprobando que no cambien coordenadas ni perfiles importantes.

No confiar en la compresión para resolver draw calls o exceso de polígonos: bajar bytes descargados y bajar costo GPU son dos objetivos distintos.

## Renderizado y materiales

- Usar Three.js + WebGL 2 como base inicial; WebGPU es optativo y requiere benchmarks y fallback.
- Materiales simples y compartidos para nieve, roca, hielo y agua; usar shaders personalizados solo donde mejoren significativamente la experiencia.
- Priorizar luz direccional/ambiental simple; emplear baked AO/lightmaps en objetos **estáticos** como edificios, si su UV y costos lo justifican. No hacer bake general del paisaje si impide la coherencia del terreno o la iluminación deseada.
- Evitar transparencia excesiva, sombras dinámicas de alta resolución, reflejos costosos y postprocesado múltiple sin medición.
- Instancing para objetos repetidos; frustum culling y carga diferida para tiles y objetos fuera de vista.
- Preparar shaders/materiales esenciales antes del primer movimiento cuando evite tirones, sin bloquear innecesariamente el acceso al contenido.
- Mantener el texto, navegación y controles educativos en HTML accesible, no exclusivamente dentro de WebGL.

## Cámara, interacción y accesibilidad

- El usuario puede navegar con mouse, teclado y controles táctiles. Soportar zoom, rotación y desplazamiento guiado a hotspots.
- Incorporar límites de cámara, posición inicial definida, botón de reinicio y acceso directo a contenidos.
- Implementar comprobación de altura/colisiones sobre el terreno para evitar atravesar montañas o perderse.
- Ofrecer modo de movimiento reducido y alternativa 2D/HTML si no hay WebGL o el dispositivo es poco potente.
- Ningún paper, recurso docente o dato importante debe ser accesible únicamente mediante navegación 3D.

## Presupuestos iniciales (hipótesis, no resultados)

- **Desktop:** objetivo 60 FPS en equipo de referencia.
- **Móvil:** objetivo de al menos 30 FPS estables en equipo de gama media de prueba, con reducción automática de calidad si hace falta.
- Medir `frame time` (mediana y p95), VRAM/memoria cuando sea accesible, tamaño transferido, tiempo hasta interacción, triángulos, draw calls y tirones durante la navegación.
- Establecer un presupuesto real de descarga inicial con medidas del build. No anunciar pesos ni FPS sin benchmark.
- Separar tiempos/costos del video cinematográfico y del terreno interactivo, y no cargar ambos completos simultáneamente por defecto.

## Validación obligatoria antes de llamar una optimización "lista"

- Ejecutar la misma ruta de cámara y secuencia de interacción en calidad alta y reducida.
- Probar en desktop, móvil real o emulación con limitaciones explícitas, red lenta y dispositivo sin WebGL si es posible.
- Comparar captura antes/después para detectar defectos en relieve, texturas y uniones de tiles.
- Mostrar tabla **antes / después**: bytes, tiempo de carga, FPS o frame time, draw calls, triángulos, errores visuales y hardware.
- Mantener un registro de decisiones y compensaciones de calidad visual.

## Orden de trabajo

**P0:** preparación del proyecto, herramientas y medición de rendimiento.
**P1:** obtener y verificar un recorte REMA real; reconstruir correctamente el terreno.
**P2:** LOD, compresión, materiales y carga optimizados; benchmarks.
**P3:** navegación espacial y puntos educativos conectados a contenido validado.
**P4:** efectos cinematográficos, shaders adicionales y pulido solo si P1–P3 funcionan.

Este orden es una **propuesta de organización técnica**, no implica que P0/P1 del repositorio actual tengan estas definiciones: respetar las tareas ya establecidas por el equipo.

## Instrucción para Claude Code

Antes de implementar, inspeccioná el código existente y explicá qué se reutiliza y qué se cambia. Elegí la solución más simple que cumpla el objetivo; no reescribas la arquitectura sin justificación. Priorizá un pequeño terreno real, verificable, navegable y medido por encima de una escena visualmente grande sin datos científicos auténticos. Si una referencia pública no confirma una técnica, tratala como hipótesis y verificá antes de atribuírsela.
