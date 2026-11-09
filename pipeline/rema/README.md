# Pipeline REMA — caleta Potter (isla 25 de Mayo / King George Island)

Recorte reproducible del **Reference Elevation Model of Antarctica (REMA), Mosaics v2.0** (Polar Geospatial Center, PGC) para caleta Potter, la Base Carlini y el frente del glaciar Fourcade. Es **dato observado** (un modelo digital de superficie fotogramétrico), no relieve sintético.

## Cómo reproducirlo

Requisitos: Node ≥ 22 y conexión a internet. No hace falta Python, GDAL, cuenta ni clave de API.

```bash
cd pipeline/rema
npm install
npm run fetch        # recorte a 2 m  -> data/rema/potter-cove_2m.*
npm run fetch:10m    # recorte a 10 m -> data/rema/potter-cove_10m.*   (opcional, liviano)
npm run check        # control de alturas -> data/rema/potter-cove_2m_sanity.json
```

Opciones de `fetch-potter-cove.mjs`: `--res 2|10|32`, `--bbox xmin,ymin,xmax,ymax` (EPSG:3031), `--name`, `--out`, `--dry-run`. Si no pasás `--res`, el script elige la resolución más fina cuyo recorte float32 sin comprimir no supere los 150 MB.

El script **solo lee la ventana del área de interés** desde los Cloud Optimized GeoTIFF públicos de AWS mediante pedidos HTTP por rangos (~16 MB transferidos para el recorte a 2 m). No descarga teselas ni mosaicos completos. La salida es determinística: el SHA-256 del GeoTIFF figura en el JSON.

## Archivos generados (`data/rema/`)

| Archivo | Contenido |
|---|---|
| `potter-cove_2m.tif` | DEM float32 de 4000 × 4000 px, EPSG:3031, alturas en m sobre el **elipsoide WGS84**, nodata = −9999, DEFLATE (~10,5 MB) |
| `potter-cove_2m_count.tif` | Asset `count` de REMA: cantidad de tiras DEM por píxel (uint8, 0 = ninguna) |
| `potter-cove_2m.json` | Procedencia completa: URL, teselas, ventanas, bbox en ambos CRS, estadísticas, nodata, datum, licencia, cita y SHA-256 |
| `potter-cove_2m_sanity.json` | Comparación con alturas publicadas |
| `potter-cove_2m_preview16.png` / `_hillshade.png` | Vistas previas **reducidas** (1000 px, 8 m/px), solo para inspección visual |
| `potter-cove_10m.*` | Lo mismo a 10 m (800 × 800 px) |

Orientación: las filas siguen el norte de la grilla EPSG:3031. En esta longitud, el **norte geográfico apunta arriba a la izquierda** de la imagen (unos 59° de rotación). La caleta se abre hacia abajo (OSO, bahía Maxwell). Base Carlini y el cerro Tres Hermanos quedan en la orilla derecha (SSE). El glaciar Fourcade ocupa la cabecera y la orilla izquierda.

## Fuentes

- REMA v2.0 en AWS Open Data: STAC `https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/rema.json`, registro `https://registry.opendata.aws/pgc-rema/`. Teselas usadas: `46_04_2_2_2m_v2.0` y `47_04_1_2_2m_v2.0` (a 10 m: `46_04_10m_v2.0` y `47_04_10m_v2.0`).
- Documentación de PGC: https://www.pgc.umn.edu/data/rema/ y https://www.pgc.umn.edu/guides/stereo-derived-elevation-models/pgc-dem-products-arcticdem-rema-and-earthdem/
- Coordenadas de referencia: SCAR Composite Gazetteer of Antarctica (https://placenames.aq, API `/api/place_names`). Caleta Potter: name_id 110689 y 101894. Carlini: 136127. Glaciar Fourcade: 135244. Three Brothers Hill: 111576 y 132669. Cerro Tres Hermanos: 106381. Mirounga Point: 110172. Península Barton: 107687.
- Geoide: GeographicLib GeoidEval online (EGM2008 y EGM96), consultado el 2026-11-08.

## Área de interés

El AOI está en EPSG:3031 (la proyección nativa, así no hay que remuestrear): `[-2631000, 1595500, -2623000, 1603500]`, 8 × 8 km. En WGS84 equivale a la envolvente lon −58,7664 a −58,5616 y lat −62,2756 a −62,1800 (las esquinas exactas están en el JSON). Se eligió para cubrir con margen los puntos del gazetteer y la cabecera de la caleta, verificando visualmente sobre el sombreado.

## Altura: elipsoide vs. nivel del mar

REMA da **alturas elipsoidales (WGS84)**, según PGC. Para mostrar "metros sobre el nivel del mar" aproximados usá `H = h − N`. En la zona, N(EGM2008) va de 21,56 a 21,92 m y N(EGM96) de 21,92 a 22,04 m. Para una visualización alcanza con restar una constante de ~21,8 m (error < 0,3 m). El nivel del mar real difiere además por mareas y por la topografía dinámica del océano.

## Hallazgos de cobertura

- **Sin huecos (0 % nodata)** en el AOI, a 2 m y a 10 m.
- **El mar no es una medición.** PGC enmascaró el océano con la costa del Antarctic Digital Database y le asignó una altura de superficie del mar. En el recorte el agua vale ~21,92–22,01 m y es plana (≈ 28 % del AOI según la heurística del JSON). Empíricamente coincide con EGM96 (diferencias ≤ 0,01 m en 3 puntos); la guía de PGC no dice qué modelo usó.
- `count = 0` (sin ninguna tira) marca solo bloques de mar abierto (8,6 %). Dentro de la caleta el agua también está aplanada aunque `count > 0`.
- El mosaico mezcla tiras de **2010 a 2020** (mediana). No es una foto de un solo día. El frente del glaciar Fourcade se mueve, así que su posición en el DEM no corresponde a una fecha única ni a hoy.
- Los valores vienen cuantizados a 1/128 m (~0,8 cm) en los COG de PGC.
- En la franja de solapamiento entre las dos teselas (100 m), la diferencia media es de 0,0014 m y la máxima de 5,26 m. Se conserva el valor de la primera tesela.

## Control de alturas (resultado del `sanity-check`)

| Punto | REMA | Publicado | Comentario |
|---|---|---|---|
| Agua de la caleta | h = 21,98 m | N EGM96 = 21,99 m; N EGM2008 = 21,79 m | Coherente, pero es relleno de PGC: no valida el DEM |
| Cerro Tres Hermanos (máximo a ≤ 500 m del punto GBR) | h = 220,38 m → H ≈ 198,6 m (EGM2008) | 195 m (GBR), 210 m (USA), 213 m (CHL) | +3,6 / −11,4 / −14,4 m. Las fuentes publicadas ya difieren 18 m entre sí y no declaran datum |
| Base Carlini (punto del gazetteer) | H ≈ 15,2 m; mediana a 100 m: 13,0 m | 10 m (USA) | Razonable para un DSM con edificios y un punto aproximado |

## Licencia y cita

- Licencia: **CC BY 4.0**, según el catálogo STAC de PGC y el AWS Open Data Registry.
- Cita: Howat, Ian, et al., 2022, "The Reference Elevation Model of Antarctica – Mosaics, Version 2", https://doi.org/10.7910/DVN/EBW8UC, Harvard Dataverse, V1, [consultado el 2026-11-08].
- Agradecimiento (política de PGC): "DEMs provided by the Byrd Polar and Climate Research Center and the Polar Geospatial Center under NSF-OPP awards 1043681, 1542736, 1543501, 1559691, 1810976, and 2129685."
- AWS: "Reference Elevation Model of Antarctica (REMA) was accessed on 2026-11-08 from https://registry.opendata.aws/pgc-rema."

## Limitaciones y pendientes

- Es un **DSM**: incluye edificios y la superficie del hielo. No es el terreno bajo el hielo.
- La precisión absoluta de los mosaicos v2 **no está validada** por PGC (lo dice su guía).
- No se verificó qué versión de la costa ADD se usó ni si coincide con el frente actual del Fourcade. Para la narrativa del retroceso del glaciar hacen falta fuentes específicas (por ejemplo, tiras REMA fechadas o imágenes Sentinel-2).
- El GeoTIFF se escribe con un escritor propio (`lib/tiff-writer.mjs`) y se verifica releyéndolo con geotiff.js, bit a bit. **No se probó todavía en QGIS ni en GDAL.**
- OpenTopography ofrece REMA 2 m solo con login (académico o por solicitud). No se usó.
- El root del proyecto no ignora `pipeline/rema/node_modules`; este paquete trae su propio `.gitignore`.
