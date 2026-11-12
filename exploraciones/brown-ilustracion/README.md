# Brown: laboratorio de ilustración

Copia independiente del visor y de los datos de Base Brown. No usa enlaces a src ni a los terrenos del proyecto original. Sus dependencias se instalan en esta carpeta.

Inicio: npm run dev. Vista previa: http://127.0.0.1:3401/?nivel=8m
Compilación: npm run build.

Puntos para experimentar:
- src/shaders.ts: shaders y mezcla de nieve/roca.
- src/materials.ts y src/terrain-textures.ts: texturas y sus parámetros.
- src/ocean.ts: agua, si el estilo también la necesita.
- src/view-controls.ts: controles del laboratorio.

El acabado por defecto es cozy hand-painted: nieve marfil, sombras azuladas y roca mate con planos definidos. «Forma del terreno» alterna relieve original y formas ilustradas; «Acabado» permite comparar los materiales. La forma ilustrada modifica únicamente la copia en memoria: redondea nieve y agrupa roca en planos amplios, con desplazamiento limitado a 24 m y costa/bordes protegidos. Los chunks interiores completos usan como mínimo el paso 2 del LOD existente, manteniendo todos los vértices del perímetro y el detalle costero. Los DEM guardados permanecen intactos. La cámara se conserva al cambiar la forma. Los cambios de este laboratorio no se trasladan automáticamente al visor original del puerto 3400.

Los datos públicos de esta copia contienen únicamente Brown, en 4 m y 8 m. No ejecutar aquí los scripts de generación del proyecto original. source-snapshot.json registra la procedencia de los archivos copiados.

Cozy: agua anime opaca con tonos amplios y trazos de ondas; ajuste local de picos costeros en modo artístico sin mover XY ni bordes de chunks. Huellas: activar el botón y tocar nieve de poca pendiente, o Shift+clic. Área de interacción de 32 × 32 m; Borrar huellas permite elegir otra zona. Compresión máxima 22 cm, persistente durante la sesión y reiniciada al cargar terreno. La textura de 16 KiB aporta el detalle fino de normales; el desplazamiento geométrico se limita a los vértices existentes. Es una aproximación de compresión, no un simulador volumétrico de nieve.
