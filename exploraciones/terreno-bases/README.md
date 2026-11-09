# Exploración · terreno de las bases argentinas

> **Prueba aislada, no es el sitio.** Explora si se puede ubicar las bases antárticas argentinas en un mapa y entrar a un terreno 3D navegable con relieve real de cada una, con peso y rendimiento razonables para web.

Dos vistas:
- `bases.html`: mapa de la Antártida con las 13 bases (COMNAP) sobre la costa SCAR ADD.
- `index.html?base=<id>`: terreno 3D de 8×8 km alrededor de la base, relieve REMA 2 m y mar según la costa ADD.

## Correrlo

```bash
npm install
npm run dev       # http://localhost:3200/bases.html  ·  terreno: /?base=carlini  (?res=512 o ?res=1024 fuerza un nivel)
```

Los terrenos y el mapa ya procesados están en `public/`, así que no hace falta correr el pipeline. Para regenerarlos: `npm run build:map` y `npm run convert -- --all` (ver más abajo).

`convert` toma el DEM de mayor resolución en `../../data/rema/` y la costa en `../../data/costa/`.

## Datos

| Capa | Fuente | Licencia | Tipo de evidencia |
|---|---|---|---|
| Relieve | REMA Mosaics v2.0, 2 m (PGC), recorte 8×8 km, EPSG:3031 | CC BY 4.0 | Observación: DSM fotogramétrico, mediana 2010–2020 |
| Línea de costa | SCAR Antarctic Digital Database v7.12 (2025), polígonos de alta resolución | CC BY 4.0 (inferida de fichas de versiones previas; confirmar para v7.12) | Compilación cartográfica |
| Colores nieve/roca | Pendiente del terreno | — | Reconstrucción artística (no es cobertura del suelo) |

- Alturas sobre el elipsoide WGS84. Para metros sobre el nivel del mar: H ≈ h − 21,8 m (EGM2008 en la caleta).
- El mar de REMA no es una medición: PGC lo enmascara con la costa ADD y lo rellena con una altura plana (~22,0 m).
- Procedencia completa: `../../data/rema/potter-cove_2m.json` y `../../data/costa/add-v7.12-potter-cove.meta.json`.

**Citas**
- Howat, I., et al. (2022). *The Reference Elevation Model of Antarctica – Mosaics, Version 2*. Harvard Dataverse. https://doi.org/10.7910/DVN/EBW8UC
- DEMs provided by the Byrd Polar and Climate Research Center and the Polar Geospatial Center under NSF-OPP awards 1043681, 1542736, 1543501, 1559691, 1810976, and 2129685.
- SCAR Antarctic Digital Database, 2025, https://doi.org/qc9x

## Control costa ADD vs. REMA (2 m)

- Mar según ADD: alturas REMA p5–p95 = 21,97–22,01 m, coincide con el relleno plano de PGC.
- ~0,14 km² de "mar" ADD está >5 m sobre ese nivel (píxeles sueltos de borde).
- ~0,96 km² de "tierra" ADD tiene la altura del relleno del mar, repartido por la orilla (playas bajas o diferencia entre versiones de costa; sin confirmar).

## Rendimiento medido

PC con GPU integrada AMD Radeon, navegador del panel de Claude, 1352×787 px:

| Nivel | Triángulos | Render sincronizado | FPS en loop |
|---|---|---|---|
| 500×500 (16 m) | 0,5 M | ~6 ms | 60 |
| 1000×1000 (8 m) | 2 M | ~17 ms | 60 (al límite) |

### Optimizaciones para web (aplicadas)

1. **Terrenos precomprimidos (gzip)**: no dependen de que el hosting comprima binarios. Se descomprimen en el navegador con `DecompressionStream`; si el servidor ya los entregó descomprimidos (`Content-Encoding`), se detecta por la firma gzip y se usan tal cual.
2. **Web Worker** (`src/terrain.worker.ts`): descompresión, decodificación, normales, colores e índices fuera del hilo principal. También el cambio de exageración vertical.
3. **Render a demanda**: solo se dibuja mientras la cámara se mueve (incluida la inercia); en reposo el bucle se apaga.
4. **Carga progresiva**: primero el nivel liviano, después el detallado en segundo plano (solo en pantallas grandes con mouse).

| Medición (misma PC, Carlini / San Martín) | Antes | Después |
|---|---|---|
| Hasta ver el terreno | ~600 ms (1er cuadro) | 92–130 ms |
| Bloqueo máximo del hilo principal al cargar | 355–570 ms (armado de malla) | 68–91 ms |
| Cambiar exageración vertical | ~250 ms trabado | sin tareas largas (< 50 ms) |
| Cuadros dibujados en reposo | 60 por segundo | 0 |
| Descarga por base (sin depender del hosting) | 0,75–3 MB sin comprimir | 67–244 KB liviano · 222–865 KB detallado |

Los FPS no se pudieron medir en este entorno (el navegador del panel frena los cuadros cuando la pestaña no está en primer plano). Sin medir en celular real todavía: usar "Copiar métricas" en un equipo de gama media.

## Mapa de bases argentinas (`bases.html`)

```bash
npm run build:map   # CSV COMNAP + costa ADD → public/map/ (--refresh vuelve a consultar el ADD)
```

- 13 bases según COMNAP (nov 2024): 7 permanentes y 6 temporarias. Uso permitido solo educativo y no comercial; citar "COMNAP 2024".
- Costa: SCAR ADD v7.12, resolución media. El mapa general pesa 31 KB (brotli). El detalle de la Península (simplificado a 400 m, 52 KB) se descarga solo al acercarse.
- Proyección EPSG:3031 propia, contrastada con proj4: diferencia máxima 5 m.
- `bases.html#<base>` abre la base seleccionada; `?base=<base>` abre su terreno 3D.

## Terrenos de las 13 bases

```bash
cd ../../pipeline/rema && node fetch-bases.mjs     # REMA 2 m (8×8 km centrados en cada base) + geoide + costa ADD
cd ../../exploraciones/terreno-bases && npm run convert -- --all
```

- Las 13 tienen 0 % sin dato. Belgrano II no tiene mar en su recuadro (está tierra adentro).
- Peso por base (gzip, ya comprimido en disco): 67–244 KB nivel liviano, 222–865 KB detallado. Solo se descarga la base que se abre.
- Control de altura en la base: REMA (h − N EGM2008, píxel en la coordenada COMNAP) vs. altura publicada por COMNAP. Diferencias entre +3 y −26 m (Primavera). REMA es un modelo de superficie y la coordenada COMNAP es aproximada; en laderas un error de ubicación de decenas de metros cambia mucho la altura. Detalle en `data/rema/bases-summary.json`.

## Qué se versiona en git

| Qué | Tamaño | ¿En git? |
|---|---|---|
| GeoTIFF REMA 2 m y vistas previas (`data/rema/*.tif`, `*.png`) | ~100 MB | No: se regeneran (ver abajo) |
| Procedencia, controles y sha256 (`data/rema/*.json`) | 0,2 MB | Sí |
| Costa ADD recortada a cada recuadro (`data/costa/`) | 3 MB | Sí |
| Terrenos y mapa listos para la web (`public/terrain`, `public/map`) | 8,6 MB (los terrenos ya van comprimidos) | Sí: el sitio funciona sin correr el pipeline |

Para regenerar los GeoTIFF (descarga ~15 MB por base del bucket público de PGC, sin cuenta):

```bash
cd ../../pipeline/rema && npm install
node fetch-potter-cove.mjs     # Carlini / caleta Potter
node fetch-bases.mjs           # las otras 12 bases
```

Cada `data/rema/<base>_2m.json` guarda el sha256 del GeoTIFF: si coincide, el recorte es idéntico al usado. La costa del ADD se recorta al recuadro de cada base (el servicio devuelve el continente entero si se lo toca: ~83 MB por base); se comprobó que las máscaras resultantes son idénticas byte a byte a las generadas con la costa completa.

## Pendiente

- Flecha de norte geográfico (el "arriba" de EPSG:3031 no es el norte).
- LOD por teselas para acercarse a 2 m sin cargar todo.
- Medir en celular.
