# Antaris Polar · exploraciones

Plataforma web educativa sobre ciencia antártica para **SoberaníaTech 2026** (Eje 02: Antártida, Ciencia y Conocimiento Abierto).

> **El sitio todavía no está implementado.** Este repositorio reúne **exploraciones aisladas**: pruebas de secciones, técnicas y datos que después pueden integrarse (o descartarse). Cada exploración se corre sola y no depende de las demás.

## Exploraciones

| Exploración | Qué prueba | Estado | Fecha |
|---|---|---|---|
| [terreno-bases](exploraciones/terreno-bases/) | Mapa de las 13 bases antárticas argentinas y terreno 3D navegable de cada una con relieve real REMA 2 m, mar según la costa SCAR ADD | Prueba funcional | 2026-11-08 |
| [terreno-nitidez](exploraciones/terreno-nitidez/) | Terreno más nítido sin pesar más: alturas a 4 m con precisión de 0,5 m, luz y color por píxel, sombreado de cavidades. Botón Antes/Después | Prueba funcional | 2026-11-09 |
| [terreno-estilizado](exploraciones/terreno-estilizado/) | Interpretación artística basada en REMA (estética de videojuego premium): sombras de sol fijo, roca/nieve/hielo/agua, bordes integrados; terreno por bloques con LOD (GPU −67 %, memoria 79 → 30 MB); detalle de cerca generado (0 bytes). Banco de medición reproducible | Fases 1–3A de 4 | 2026-11-09 |

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
| COMNAP Antarctic Facilities (nov 2024) | Ubicación de bases | Solo uso educativo y no comercial; citar "COMNAP 2024" |
| GeographicLib GeoidEval (EGM2008/EGM96) | Alturas sobre el nivel del mar | Servicio público de cálculo |

Los GeoTIFF REMA crudos (~100 MB) no se versionan: se regeneran con `pipeline/rema` y se verifican con el sha256 guardado en `data/rema/<base>_2m.json`.
