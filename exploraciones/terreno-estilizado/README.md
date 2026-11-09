# Exploración · terreno estilizado (fase 1)

> **Prueba aislada, no es el sitio.** **Interpretación artística basada en REMA**, no una reconstrucción geográfica exacta. El relieve es dato (REMA v2.0, costa SCAR ADD v7.12); las sombras de un sol fijo, los materiales, el hielo costero, la variación procedural y el tratamiento de bordes son estilización.

Objetivo: estética de videojuego premium (montañas definidas, roca, nieve, hielo y agua legibles) con rendimiento medido. Sigue `.claude/rules/3d-performance.md`.

## Correrlo

```bash
npm install
npm run dev      # http://localhost:3400/?base=brown
```

- Botón **Base / Interpretación** (tecla `A`): "Base" reproduce el sombreado de [`terreno-nitidez`](../terreno-nitidez/) para comparar con la misma app, datos y cámaras.
- **Medir**: corre el banco de medición (5 cámaras fijas × 20 cuadros, tiempo de GPU por consulta de temporizador).
- Parámetros: `?base=<id>`, `?nivel=4m|8m`, `?estilo=base`, `?pose=0..4` (cámaras del banco), `?ui=0` (sin interfaz, para capturas).
- Los terrenos se leen de `../terreno-nitidez/public` (mismo formato; evita duplicar ~8,5 MB). Ver `vite.config.ts`.

## Diagnóstico (antes de cambiar nada)

| Causa | Evidencia | Peso |
|---|---|---|
| Iluminación plana: sin sombras proyectadas, roca casi negra del lado de la cámara, nieve quemada por ACES, rugosidad única | capturas *antes* | muy alto |
| Material de dos colores por pendiente: roca en manchas difusas, sin hielo, agua mate | capturas *antes* | alto |
| Textura estirada en paredes (proyección desde arriba) | Petrel 3× *antes* | alto en acantilados |
| De cerca no hay más dato: 4 m de dato vs ~1,4 m por píxel | medido | alto de cerca |
| Ondulaciones de cuantización con exageración alta | Petrel 3× *antes* | medio |
| 2 M triángulos siempre, sin LOD ni descarte; 27–82 % del recorte es mar plano | medido | rendimiento |
| Bordes del recorte como "bloque cortado" | capturas *antes* | medio |
| Anisotropía fija en 8 (la GPU admite 16) | medido | bajo |
| NoData | 0 % en las 13 bases | no es causa |

## Cambios de la fase 1

1. **Sombra de sol fijo precalculada** en el worker (marcha de rayos sobre el relieve, penumbra suave). 0 bytes de descarga, 0 costo por cuadro; ~0,8 s de worker. Solo afecta a la luz directa.
2. **Luz y tono**: sol bajo y de costado, luz ambiente con rebote de nieve, tonemapping *Neutral* (no quema la nieve), exposición 0,95.
3. **Materiales**: roca de dos tonos con vetas y borde nítido e irregular; nieve azulada en cavidades; hielo azul en paredes junto a la costa y a poca altura (interpretación); agua más clara cerca de la costa con espuma fina; rugosidad por material (hielo y agua brillantes, roca mate).
4. **Variación triplanar** (no se estira en paredes) leyendo una textura de ruido de 256² generada al cargar (0 bytes).
5. **Normales Sobel 3×3** y más iteraciones de des-cuantización: eliminan las ondulaciones con exageración.
6. **Bordes**: mar extendido hasta el horizonte; solo la última franja (~60 m) del recorte baja al mar; el resto del borde se funde con la niebla **por color**, sin tocar el relieve.
7. **Anisotropía al máximo** de la GPU (16).

## Antes / después medido

Brown, nivel 4 m, mismo recorrido de 5 cámaras, 20 cuadros por cámara. PC con GPU integrada AMD Radeon (ANGLE/D3D11), lienzo 1150×787 a dpr 1,25, navegador del panel de Claude. Tiempo de GPU con `EXT_disjoint_timer_query_webgl2`.

| | Base (≈ terreno-nitidez) | Interpretación (fase 1) |
|---|---|---|
| GPU por cuadro, mediana | 7,1 ms | **8,6 ms** |
| GPU por cuadro, p95 | 9,4 ms | **14,2 ms** |
| Peor cámara (cenital) | 8,4 ms | 13,3 ms |
| Triángulos | 2,0 M | 2,0 M (+ 2 del mar extendido) |
| Draw calls | 1 | 2 |
| Memoria GPU (geometría + texturas, estimada) | 53,4 + 25,4 MB | igual |
| Descarga | 860 KB | 860 KB |
| Worker (carga del nivel 4 m) | — | 2,5 s (sombras 0,8 s) |

Registro de decisiones:
- La primera versión calculaba el ruido por píxel con fbm procedural: **20,7 ms de mediana / 33,7 ms p95** (3,3× más lento que Base). Se reemplazó por la textura de ruido: 8,6 / 14,2 ms con aspecto equivalente.
- La primera versión bajaba el relieve en los últimos 450 m del recorte y **borraba un pico** en Brown (vista rasante). Se reemplazó por la disolución por color; los perfiles ahora coinciden con Base.
- El hielo azul se restringió a ~40 m de la costa y < 60 m sobre el mar: con 160 m teñía islotes enteros.

Capturas en `capturas/` (pares *antes* / *después*). En Petrel, el *antes* es `terreno-nitidez` y el encuadre del *después* no es idéntico.

## Pendiente (no medido o fuera de la fase 1)

- **FPS reales y celular**: no medidos (el panel frena `requestAnimationFrame`; el banco usa render sincrónico).
- **Fase 2 (geometría)**: LOD por bloques sin grietas, mar como plano único, descarte por cámara. Es la que más baja la carga de GPU y memoria (hoy 2 M triángulos y ~79 MB).
- **Fase 3 (detalle de cerca)**: texturas de detalle KTX2 (UASTC normales / ETC1S color) vs. detalle procedural; elegir por resultado medido.
- **Fase 4**: calidad adaptativa (DPR, sombras, detalle) según el tiempo por cuadro.
- La línea serpenteante sobre la nieve de Petrel también aparece en el dato (no es costa ADD); sin identificar.
