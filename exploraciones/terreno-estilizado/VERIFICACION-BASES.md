# Bases: verificación editorial y coordenadas
Consulta: 18 de noviembre de 2026.
Fuente principal: Atlas IGN, geostory 4872, contenido JSON público consultado. Fechas, nombres, clasificación y coordenadas: tabla IGN.
No se desplazó ningún marcador. `mapa` conserva las coordenadas y proyección de cada terreno; `coordenadas` registra el IGN para la ficha. Los metadatos de terreno mantienen su información de procesamiento.
| Base | Coordenadas del terreno (lat, lon) | Coordenadas IGN (lat, lon) |
|---|---|---|
| Base Belgrano II | -77.873889, -34.627778 | -77.875556, -34.679444 |
| Base Carlini | -62.2379, -58.666842 | -62.238333, -58.666944 |
| Base Esperanza | -63.396959, -56.998054 | -63.398056, -56.997222 |
| Base Marambio | -64.241769, -56.623225 | -64.241111, -56.625278 |
| Base Petrel | -63.478303, -56.230993 | -63.477778, -56.226944 |
| Base San Martín | -68.1303, -67.102931 | -68.130000, -67.100833 |
| Base Orcadas | -60.737592, -44.737387 | -60.737778, -44.740000 |
| Base Brown | -64.89537, -62.870452 | -64.895278, -62.870556 |
| Base Cámara | -62.593858, -59.919344 | -62.595000, -59.918333 |
| Base Decepción | -62.97676, -60.700695 | -62.975556, -60.697778 |
| Base Matienzo | -64.975865, -60.070948 | -64.975833, -60.070833 |
| Base Melchior | -64.325705, -62.976329 | -64.325833, -62.976389 |
| Base Primavera | -64.155854, -60.954256 | -64.155833, -60.954722 |

## Discrepancias editoriales
- Petrel: tabla IGN 1/12/1952; carrusel del Atlas 22/02/1967. Se utiliza la tabla como indicó el encargo; queda pendiente conciliar los hitos históricos.
- Orcadas: tabla IGN 22/02/1904; carrusel del Atlas 1903. La narración del Atlas distingue el origen de la estación y su transferencia a Argentina en 1904. Se utiliza 1904.
- El carrusel ubica erróneamente Primavera en isla Dundee y Petrel en Orcadas. Las fichas usan la tabla y los capítulos específicos: cabo Primavera/costa Danco e isla Dundee, respectivamente.
- No se incluyeron cifras de población, clima ni estados de obras actuales sin verificación adicional. Las funciones se resumen a partir del Atlas (publicado en 2024); no se afirma un estado de obras a noviembre de 2026.
- Pendiente: decidir si se deben recalibrar los terrenos y marcadores con coordenadas IGN. Requiere revisar la proyección y el ajuste de cada terreno; no se hizo automáticamente.
- Se consultaron las 13 secciones del Atlas; no falta ninguna descripción ni fuente. No se reutilizaron fotografías.

## Validación
- TypeScript y compilación Vite correctos, sin dependencias agregadas al proyecto.
- Prueba en navegador de las 13 opciones: nombre e identificador correctos, dos fuentes por ficha.
- Prueba de clic en los 13 marcadores: cada uno enfoca la ficha de su identificador.
- Revisión móvil a 390 × 844: selector y ficha apilados, datos accesibles sin interacción con el mapa.
- Panel público sin marca introductoria, datos y navegación ni desplegable de edificios; controles de exploración conservados.
