# Exploración · terreno estilizado (fases 1, 2, 3A y 4)

> **Prueba aislada, no es el sitio.** **Interpretación artística basada en REMA**, no una reconstrucción geográfica exacta. El relieve es dato (REMA v2.0, costa SCAR ADD v7.12); las sombras de un sol fijo, los materiales, el hielo costero, la variación procedural y el tratamiento de bordes son estilización.

Objetivo: estética de videojuego premium (montañas definidas, roca, nieve, hielo y agua legibles) con rendimiento medido. Sigue `.claude/rules/3d-performance.md`.

## Correrlo

```bash
npm install
npm run dev      # http://localhost:3400/?base=brown
```

- Botón **Base / Interpretación** (tecla `A`): "Base" reproduce el sombreado de [`terreno-nitidez`](../terreno-nitidez/) para comparar con la misma app, datos y cámaras.
- **Medir**: corre el banco de medición (5 cámaras fijas × 20 cuadros, tiempo de GPU por consulta de temporizador).
- Tecla `D` o `?detalle=0`: apaga el detalle de cerca (fase 3A) para comparar.
- Selector **Calidad** (Automática / Alta / Media / Baja) o `?calidad=alta|media|baja` (fase 4).
- Selector **Material**: Corregido (predeterminado), A anterior, B, C; tecla `M` o `?material=n|a|b|c`.
- Parámetros: `?base=<id>`, `?nivel=4m|8m`, `?estilo=base`, `?geo=completa` (malla única de la fase 1, para medir el antes), `?pose=0..4` (cámaras del banco), `?ui=0` (sin interfaz, para capturas).
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

## Fase 2 · geometría con nivel de detalle

Qué cambió (`src/lod.ts`, `src/shaders.ts`):

1. **Terreno por bloques** de 128 celdas (8×8 bloques en el nivel de 4 m). **Una plantilla de geometría por nivel** (paso 1, 2, 4 y 8 celdas = 8, 16, 32 y 64 m entre vértices) que solo contiene índices de celda: **la altura la lee el vertex shader de una textura** (R32F, sin filtrar).
2. **Un `InstancedMesh` por nivel**: como máximo 4 draw calls para todo el terreno.
3. **Elección de nivel por tamaño en pantalla** de una celda (≤ 7 px) y **descarte por pirámide de visión** con la caja de alturas real de cada bloque.
4. **Faldones** en el borde de cada bloque (bajan 1,5 celdas del nivel + 5 m) para tapar las uniones entre bloques de distinto nivel. Sin grietas visibles en las 5 cámaras.
5. **Mar**: el plano dibuja el mar abierto con el mismo color de costa y sombra; el terreno sigue dibujando el agua costera (< ~90 m de la costa, idéntica a la fase 1) y no se dibujan bloques sin tierra a menos de 96 m.
6. **Material más simple de lejos**: los niveles 3 y 4 omiten las 3 lecturas de vetas finas.
7. **Exageración vertical = un uniform**: ya no se reconstruyen vértices (sin tareas largas en el hilo principal al cambiarla).

### Antes / después medido (fase 1 → fase 2)

Brown, nivel 4 m, estilo Interpretación, mismas 5 cámaras × 20 cuadros, misma PC y lienzo que la fase 1.

| | Fase 1 (`?geo=completa`) | Fase 2 (LOD) |
|---|---|---|
| GPU por cuadro, mediana | 8,8 ms | **2,9 ms** (−67 %) |
| GPU por cuadro, p95 | 12,3 ms | **3,9 ms** |
| Triángulos (general / media / cerca / rasante / cenital) | 2,0 M en todas | 142 k / 307 k / 249 k / 262 k / 118 k |
| Draw calls | 2 | 2–4 |
| Memoria GPU geometría | 53,4 MB | **0,8 MB** |
| Memoria GPU texturas (estimada, con mipmaps) | 25,4 MB | 29,2 MB (+ textura de alturas 4 MB) |
| Total GPU estimado | ~79 MB | **~30 MB** |
| Descarga | 860 KB | 860 KB |

El tiempo del worker varió entre corridas en este entorno (2,5–4,3 s; sombras 0,8–1,7 s) por competir con otras pestañas: no es comparable entre fases.

Registro de decisiones:
- Con el agua solo en el plano apareció una **franja gris sobre la costa**. No era la geometría (forzar un nivel más fino en la costa subió a 520 k triángulos sin cambiarla) ni la mezcla tierra/mar: pintando el plano de rojo desapareció, así que era el agua del plano vista en ángulo rasante. Se volvió a dibujar el agua costera con el terreno.

Capturas: `capturas/brown-*-fase2-lod.jpg` (comparar con `brown-*-despues.jpg` de la fase 1, mismas cámaras).

## Fase 3A · detalle de cerca (0 bytes de descarga)

Qué cambió:

1. **Mapa de normales de detalle generado al cargar** (512², `detailTexture()` en `src/materials.ts`): roca = fbm crestado (grietas y aristas); nieve = ondas de viento suaves. **Es estilización**, no proviene de REMA.
2. **Aplicado en triplanar** (3 lecturas), un mosaico cada ~110 m (rasgos de 2–15 m), solo en bloques cercanos (los lejanos no lo compilan) y desvanecido entre 500 y 2200 m de la cámara. Intensidad por material: fuerte en roca, suave en nieve, casi nula en hielo, nada en agua.
3. **Espuma** más angosta (~10 m) y cortada por ruido: antes, de cerca, se leía como una plataforma gris de ~22 m (defecto que ya estaba en la fase 1).

Primer intento descartado: con un mosaico cada 24 m el detalle quedaba por debajo del tamaño de píxel a 300 m y el filtrado lo aplanaba (solo cambiaba el 1,9 % de los píxeles). A ~110 m cambia el 19,6 %.

### Medido (fase 2 → 3A)

Brown, nivel 4 m, Interpretación + LOD, mismas 5 cámaras.

| | Sin detalle | Con detalle |
|---|---|---|
| GPU por cuadro, mediana | 2,33 ms | 2,13 ms |
| GPU por cuadro, p95 | 3,62 ms | 3,31 ms |
| Cámara "cerca" (la que más detalle muestra) | 2,48 ms | 2,97 ms |
| Descarga | 860 KB | 860 KB |
| Memoria GPU extra | — | ~1,4 MB (textura de detalle con mipmaps; no incluida en el total del banco) |

La diferencia en la mediana está dentro de la variación entre corridas; el costo real aparece de cerca (+0,5 ms).

### KTX2 (fase 3B): no aplicado, por ahora

Las reglas piden KTX2 solo cuando lo justifique una textura descargada. Hoy **no se descarga ninguna textura de imagen**: todas (superficie, luz, ruido, detalle) se generan en el navegador. Si más adelante se suman texturas reales de roca/nieve (p. ej. CC0), corresponde **UASTC para normales** (no toleran bien la compresión agresiva) y **ETC1S para color**, comparando peso y calidad antes de adoptarlas.

Capturas: `capturas/brown-cerca-fase2.jpg` → `capturas/brown-cerca-fase3a-detalle.jpg` (misma cámara).

## Fase 4 · calidad adaptativa

Qué cambió (`src/quality.ts`):

| Nivel | DPR máx. | Densidad LOD (px por celda) | Detalle de cerca | Alturas al cargar |
|---|---|---|---|---|
| Alta | 2 | 7 | sí | 4 m (progresivo desde 8 m) |
| Media | 1,25 | 11 | sí | 4 m en escritorio, 8 m en celular |
| Baja | 1 | 18 | no | 8 m |

- **Nivel inicial por dispositivo** (heurística, no medición): celular = sin ningún puntero fino o pantalla física < 500 px en su lado corto; gama baja = ≤ 4 núcleos o ≤ 4 GB (`deviceMemory`). Escritorio → alta (media si es gama baja); celular → media (baja si es gama baja).
- **Ajuste automático** mientras la cámara se mueve: mediana de 40 cuadros del tiempo de GPU (`EXT_disjoint_timer_query_webgl2`). Baja de nivel si supera el presupuesto (12 ms escritorio, 26 ms celular); sube solo tras 3 ventanas seguidas por debajo del 35 % del presupuesto; espera 3 s entre cambios. Sin temporizador de GPU (frecuente en celulares y Safari) usa el intervalo entre cuadros y **solo baja** (rAF está topeado por la pantalla).
- El nivel de alturas no cambia en caliente (implicaría volver a descargar y procesar).
- **Movimiento reducido**: con `prefers-reduced-motion` la cámara no tiene inercia.

### Medido

Brown, estilo Interpretación + LOD, lienzo 1600×900 (dpr 1,25), nivel de alturas 8 m, mismas 5 cámaras. **No comparable con las tablas anteriores** (otro lienzo y otro nivel de alturas).

| Nivel | GPU mediana | GPU p95 | Triángulos (5 cámaras) |
|---|---|---|---|
| Alta | 4,1 ms | 5,0 ms | 138–376 k |
| Media | 3,3 ms | 5,3 ms | 38–267 k |
| Baja (dpr 1) | 2,0 ms | 2,9 ms | 12–174 k |

Verificado:
- Bajada automática: con un presupuesto imposible (0,2 ms) pasó de alta a media y respetó la espera.
- Escritorio (mouse, pantalla 1536×864) → alta, 4 m.
- Emulación de celular (375×812, táctil) → media, 8 m, sin scroll horizontal. La emulación hereda núcleos y memoria de la PC; un celular real de gama media reportaría menos y quedaría en baja.

Errores encontrados y corregidos: la primera heurística usaba `pointer: coarse` y el ancho de la ventana; en el navegador del panel (y en laptops táctiles) clasificaba la PC como celular.

## Prueba de materiales A / B / C

**Premisa corregida:** el pedido suponía texturas reales en KTX2. No existen: todas las texturas del terreno se generan en el navegador (ruido 256², detalle 512²) y no se descarga ninguna imagen. La prueba usa esas mismas texturas, sin agregar ni duplicar recursos. KTX2 no aplica hasta que haya texturas de imagen (fase 3B, pendiente de decisión).

### three-landscape (investigado, no instalado)

| | |
|---|---|
| Licencia | MIT |
| Mantenimiento | último cambio de código 2023-07-29; npm 0.9.2 (2023-03); 13 issues abiertos |
| Compatibilidad | requiere React 18 + React Three Fiber 8 (acá no hay React) y usa APIs de three.js eliminadas en r162 (`LinearEncoding`); usamos r181 → **no compatible tal cual** |
| Dependencias | three-custom-shader-material, glslify, memoizee, @mapbox/martini, ts-transformer-keys |
| Muestreo aperiódico | técnica 3 de I. Quílez: un ruido elige 2 de 8 desplazamientos y mezcla dos `textureGrad` → **2 lecturas por textura** |
| Triplanar | 3 lecturas (6 si es aperiódico); también ofrece "biplanar" |
| Otros | mezcla de normales RNM, mapa macro de variación, mapas precalculados para lejos; `hexagon.ts` no se usa en el material |

Se reutilizó solo la función de muestreo aperiódico (~20 líneas, con atribución en `src/shaders.ts`), con un agregado propio: cada patrón virtual también se **gira**.

### Diagnóstico de la repetición (material A)

- Ruido de manchas (256 px) repetido cada **700 m** (~11 veces por lado del recorte) y vetas cada **70 m**, ambos triplanares.
- Detalle de cerca repetido cada **110 m** (~72 veces por lado) y ondas de nieve con **una sola dirección**: la repetición más visible.
- Variación nieve/roca solo por pendiente + esos ruidos; la nieve no tiene variación propia de gran escala.
- 11 lecturas de textura por píxel cerca (3 triplanares × 3 + superficie + luz).
- Detalle con anisotropía 8 aunque la GPU admite 16 (corregido: ahora el máximo).

### Variantes

| | A · actual | B · básico | C · aperiódico |
|---|---|---|---|
| Manchas/vetas | 2 ruidos triplanares (6 lecturas), 700 m y 70 m | 1 lectura cenital, mosaico 1900 m | igual que B |
| Variación de color | pendiente | + baja frecuencia en nieve y roca | igual que B |
| Detalle de cerca | triplanar (3 lecturas), 110 m | 1 proyección (eje dominante), 97 m | B + aperiódico con giro (2 lecturas) |
| Lecturas por píxel (cerca) | 11 | 4 | 5 |

Mismo material compartido para todo el terreno (estilo Interpretación, LOD); misma geometría REMA, cámara, luz, sombra del sol y agua.

### Medido

Brown, nivel 4 m, LOD, calidad alta, lienzo 1482×797 (dpr 1,25), mismas 5 cámaras × 20 cuadros, GPU integrada AMD Radeon.

| | A | B | C |
|---|---|---|---|
| GPU por cuadro, mediana | 4,50 ms | **3,28 ms** (−27 %) | **3,53 ms** (−22 %) |
| GPU por cuadro, p95 | 7,17 ms | 4,65 ms | 4,95 ms |
| Cámara cercana | 6,79 ms | 4,08 ms | 4,66 ms |
| FPS reales (órbita de 6 s, pestaña visible) | 59,9 (frametime 16,7 ms, p95 16,8) | no válido (pestaña oculta durante la prueba) | 59,9 (frametime 16,7 ms, p95 16,8) |
| Triángulos (cámara media) / draw calls | 315 k / 4 | igual | igual |
| Memoria GPU (geometría + texturas estimadas) | 0,8 + 29,2 MB | igual | igual |
| Descarga | sin cambios (no hay texturas nuevas) | igual | igual |

Los FPS de A y C están topeados por la pantalla (60 Hz): ambos sobran en esta PC. JS total de la exploración: 147 KB gzip / 118 KB brotli (todas las fases); las variantes solo agregan texto de shader.

Capturas (misma cámara): `capturas/material-cerca-{A,B,C}.jpg`, `capturas/material-cenital-{A,B,C}.jpg`.

### Recomendación

**C**: elimina la dirección única de las ondas (la repetición más evidente), suma variación de baja frecuencia y es **22 % más barata que A**. B es apenas más barata que C (0,25 ms) pero conserva el patrón repetido. **Superada por la corrección de abajo**: C seguía mostrando ondas y roca arrugada porque la causa estaba en el contenido del mapa de detalle, no en la proyección.

## Corrección de nieve y roca (material predeterminado)

Problema reportado: ondas artificiales muy marcadas en la nieve y roca demasiado ruidosa y arrugada.

### Diagnóstico por capas

Misma cámara, luz y geometría; capas activadas progresivamente sobre el material estilizado (`window.__capa` en desarrollo). "Ruido" = diferencia media de brillo entre píxeles vecinos (×1000), separada en píxeles de nieve (claros, poco saturados) y de roca (marrones). Dos cámaras: cerca (nieve plana + costa) y roca (paredes).

| Capa | Nieve (cerca / roca) | Roca (cerca / roca) |
|---|---|---|
| A · solo colores base sobre el relieve REMA | 10,8 / 5,8 | 16,5 / 13,4 |
| B · + variación de color (cavidades, manchas, vetas) | 11,2 / 6,0 | **35,2 / 30,6** |
| C · + detalle de normales al 15 % | 11,6 / 6,9 | 35,8 / 32,9 |
| D · material anterior completo (triplanar) | **17,6 / 17,8** | **42,7 / 61,4** |
| D · con muestreo aperiódico | 17,1 / 18,0 | 26,9 / 58,3 |

Causas exactas:

1. **Ondas de la nieve** → canal de nieve de `detailTexture()`: una onda seno de amplitud 0,35 y **dirección fija** (10 ondas por mosaico de 110 m ≈ 11 m), con fuerza de normal 9. Aun al 20 % se percibe por su regularidad. Sin detalle (capas A–B) la nieve está limpia; con detalle completo el ruido sube ×1,6–×3.
2. **Roca arrugada** → dos causas sumadas: (a) la **variación de color** multiplicaba la roca por las cavidades al 25 % (calculadas a 4 m) y la mezclaba con vetas de ruido de hasta ~1 m: duplica el ruido (16,5 → 35,2); (b) el **canal de roca del detalle**: fbm crestado de 4 octavas (rasgos de hasta ~1,7 m) con fuerza 40 × 1,7.

Revisado y descartado: *normalScale* y convención OpenGL/DirectX (no hay mapas importados; los generados usan una sola convención), *colorSpace* (texturas de datos en `NoColorSpace`, correcto), *displacement* (no existe: alturas solo de REMA), KTX2 (no hay texturas de imagen).

### Corrección (`src/detail-corrected.ts`, `MAT_N` en `src/shaders.ts`)

| | Anterior | Corregido |
|---|---|---|
| Nieve · detalle | seno direccional (0,35 · 9 · 0,2) | ruido isótropo fino (~1–2 m), intensidad 0,06 |
| Nieve · acabado | rugosidad 0,82 | 0,92 (mate) |
| Roca · color | cavidades 25 % + vetas de ~1 m | solo baja frecuencia + cavidades 15 % |
| Roca · detalle | fbm crestado 4 octavas, intensidad 1,7 | 2 octavas suaves (formas de 8–15 m), intensidad 0,75 |
| Transición roca/nieve | umbral con ruido fino | umbral con ruido de baja frecuencia |
| Proyección / lecturas por píxel | triplanar / 11 | eje dominante / 4 (sin muestreo aperiódico) |

### Validación

Brown, nivel 4 m, LOD, calidad alta, lienzo 1482×797 (dpr 1,25), GPU integrada AMD Radeon.

| | Anterior | Corregido |
|---|---|---|
| Ruido nieve (cerca / roca) | 17,6 / 17,8 | **12,8 / 11,5** |
| Ruido roca (cerca / roca) | 42,7 / 61,4 | **17,8 / 17,3** |
| GPU por cuadro, mediana | 4,83 ms | **3,67 ms** (−24 %) |
| GPU por cuadro, p95 | 7,74 ms | **4,80 ms** (−38 %) |
| Cámara cercana | 7,01 ms | 4,14 ms |
| Draw calls / triángulos (cámara media) | 4 / 315 k | 4 / 315 k |
| Descarga | sin cambios (texturas generadas) | igual |
| Memoria GPU extra | — | ~1,4 MB (mapa de detalle corregido, con mipmaps) |
| FPS reales | no válido en esta sesión (pestaña oculta durante la prueba) | ídem |

En la prueba anterior A y C ya daban 59,9 FPS (topeados a 60 Hz) con un costo de GPU mayor que el corregido.

Capturas (misma cámara): `capturas/diag-roca-{A-colores-base,B-variacion-color,D-actual,corregido}.jpg` y `capturas/material-cerca-{A,corregido}.jpg`.

## Pendiente (no medido o fuera de las fases 1 a 4)

- **FPS reales y celular**: no medidos (el panel frena `requestAnimationFrame`; el banco usa render sincrónico).
- La línea serpenteante sobre la nieve de Petrel también aparece en el dato (no es costa ADD); sin identificar.
