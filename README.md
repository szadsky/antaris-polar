# Antaris Polar · exploraciones

Plataforma web educativa sobre ciencia antártica para **SoberaníaTech 2026** (Eje 02: Antártida, Ciencia y Conocimiento Abierto).

> El sitio educativo completo sigue en exploración. La compilación web reúne el visor y un laboratorio independiente del pingüino; cada experiencia carga sus propios recursos.

## Exploraciones

| Exploración | Qué prueba | Estado | Fecha |
|---|---|---|---|
| [terreno-bases](exploraciones/terreno-bases/) | Mapa de las 13 bases antárticas argentinas y terreno 3D navegable de cada una con relieve real REMA 2 m, mar según la costa SCAR ADD | Prueba funcional | 2026-11-08 |
| [terreno-nitidez](exploraciones/terreno-nitidez/) | Terreno más nítido sin pesar más: alturas a 4 m con precisión de 0,5 m, luz y color por píxel, sombreado de cavidades. Botón Antes/Después | Prueba funcional | 2026-11-09 |
| [terreno-estilizado](exploraciones/terreno-estilizado/) | Interpretación artística basada en REMA (estética de videojuego premium): sombras de sol fijo, roca/nieve/hielo/agua, bordes integrados; terreno por bloques con LOD (GPU −67 %, memoria 79 → 30 MB); detalle de cerca generado (0 bytes); calidad adaptativa. Banco de medición reproducible | Fases 1–4 (3B pendiente) | 2026-11-09 |
| [trivia-antartida](exploraciones/trivia-antartida/) | Trivia «Rumbo a la Antártida»: 5 niveles de Ushuaia a la Antártida, con premios asegurados y explicación de cada respuesta. Página estática (HTML, jQuery, toastr) | Funcional; respuestas e imágenes por verificar | 2026-11-16 |

Reglas técnicas para el 3D: [`.claude/rules/3d-performance.md`](.claude/rules/3d-performance.md).

Para correr una exploración:

```bash
cd exploraciones/<nombre>
npm install
npm run dev
```

## Estructura

```
exploraciones/<nombre>/   cada prueba, autocontenida (su package.json y su README)
pipeline/                 obtención y verificación de datos, compartida entre exploraciones
data/                     metadatos, controles y datos livianos (los rasters crudos no se versionan)
CLAUDE.md                 contexto y reglas del proyecto
```

## Datos y licencias

| Fuente | Uso | Licencia |
|---|---|---|
| REMA v2.0 (Polar Geospatial Center) | Relieve | CC BY 4.0 |
| SCAR Antarctic Digital Database v7.12 | Costa | CC BY 4.0 (confirmar para v7.12) |
| Poly Haven · Marble Cliff 04 (Amal Kumar) | Textura de roca de acantilado, 12,66 m (terreno-estilizado) | CC0 |
| ambientCG · Snow007A | Microrelieve de nieve (terreno-estilizado) | CC0 |
| COMNAP Antarctic Facilities (nov 2024) | Ubicación de bases | Solo uso educativo y no comercial; citar "COMNAP 2024" |
| GeographicLib GeoidEval (EGM2008/EGM96) | Alturas sobre el nivel del mar | Servicio público de cálculo |

Los GeoTIFF REMA crudos (~100 MB) no se versionan: se regeneran con `pipeline/rema` y se verifican con el sha256 guardado en `data/rema/<base>_2m.json`.

## Compilación web con laboratorio

Con Node.js 22.7 o posterior:

```bash
npm run setup
npm run build
npm run preview
```

Publicar el contenido de `dist/` en la raíz del alojamiento estático. El visor queda en `/`, la prueba del pingüino en `/laboratorio/pinguino/` y **Pingüino · menú** (islas de práctica para recorrer con el pingüino, Sendero por defecto, botón «Ocultar interfaz» o tecla H) en `/pinguino-menu/`. No requieren reescrituras SPA. El laboratorio tiene entrada HTML, código, modelo, texturas y licencias independientes; no se precarga desde el visor. `npm run preview` permite verificar las tres rutas en http://127.0.0.1:3410/.

La plataforma del laboratorio es sintética, no una medición REMA. Incluye WASD, Shift para correr, Espacio para saltar, R para centrar y huellas geométricas que se rellenan tras 8 + 6 segundos. Modelo: Polyfork, CC BY 4.0. Deformación: adaptación de Oguzhan Tufenk / Codrops, MIT. Los créditos y licencias acompañan la página. Las islas de Pingüino · menú también son **relieve sintético** (ruido y erosión), no geografía real ni datos REMA; ver `exploraciones/penguin-lab/LEEME.txt`.

Esta compilación no configura ni activa por sí sola un servicio de hosting.
