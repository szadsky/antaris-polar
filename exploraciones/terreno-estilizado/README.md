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

## Texturas de roca y nieve (KTX2), borde nieve-roca y costa

Sobre el material Corregido aprobado. Cambios uno por vez, con capturas desde las mismas cámaras: `capturas/texturas-antes.jpg`, `texturas-despues-borde.jpg`, `texturas-despues-costa.jpg`, `costa-sin-escalones.jpg`, `roca-acantilado-20m.jpg` y `texturas-final.jpg`.

### Qué se hizo

- **Texturas** (`scripts/texturas.mjs`; procedencia en `src/assets/texturas.json`, todas CC0):
  - Roca: Poly Haven *Marble Cliff 05* (Amal Kumar), 20 × 20 m reales. Se usan color y normal (OpenGL). **Reemplazada después por *Marble Cliff 04*** (ver más abajo).
  - Del color de la roca se usa solo la luminancia: es mármol claro, así que su estructura se lleva a la paleta de roca aprobada (percentiles 5–95 calculados en el build). La roca no queda blanca.
  - Nieve: ambientCG *Snow007A*. Solo la normal, porque el color de la nieve lo da el material. ambientCG no publica su tamaño real: **se supone 2 m**.
  - Formato: 512 px, KTX2 Basis ETC1S con mipmaps (color en sRGB, normales en modo normal map).
  - Herramientas de build: System.Drawing (Windows) reescala y `ktx2-encoder` (devDependency, MIT) codifica.
  - En la página se usa el transcodificador de Three.js (`examples/jsm/libs/basis`), copiado a `basis/` en el build. No se agregan librerías de render.
- **Técnicas de three-landscape** adaptadas al shader existente, sin instalar la librería:
  - Pesos por la máscara de pendiente (`rockT`).
  - Muestreo aperiódico (técnica 3 de I. Quílez) con `textureGrad`.
  - Normales mezcladas con RNM sobre la normal REMA.
  - Desvanecimiento por distancia.
- **Proyección biplanar**: los dos ejes dominantes de la normal REMA, sin el tercero. No hay estiramiento en pendientes y como mucho se leen dos planos por textura.
- **Lecturas condicionadas**: la roca se lee solo si `rockT > 0` y la nieve solo si `rockT < 1`; las normales, solo de cerca. Los bloques lejanos del LOD no leen normales.
- **Un material compartido** por todos los bloques. Las tres texturas son uniforms comunes.
- **Roca**: textura de acantilado a su escala física (20 m), con color y normal. Reemplazó a *Rock 01* (Poly Haven, 1,5 m), que se probó primero.
  - *Rock 01* era piedra de grano fino, sin fracturas: desde 150–600 m (la cámara no baja de 60 m) se promediaba en un color parejo a cualquier escala entre 1,5 y 30 m.
  - Con *Marble Cliff 05* las fracturas se leen sin capas procedurales; la capa de relieve procedural de 8–15 m se quitó (una lectura menos por píxel).
  - Escalas comparadas desde la misma cámara: 12, 20 y 35 m. Se eligió 20 m, el tamaño real.
- **Borde nieve-roca**:
  - El umbral de pendiente se corre con las cavidades REMA: la nieve queda en las hondonadas y la roca asoma en lo convexo.
  - La transición se recorta a ~1 píxel con `fwidth`: nítida a cualquier distancia y con antialiasing.
- **Costa sin dientes de sierra**:
  - Tierra y agua salen de la distancia con signo a la costa ADD (`scripts/costa-sdf.mjs`, `costa-4m/8m.sdf.gz`), interpolada entre texeles y recortada a ~1 píxel. Antes salían de una máscara binaria de 4 m, que dibujaba escalones.
  - No se tocó la geometría.

### Ajuste: roca más definida y borde de nieve menos duro

Pedido: "las rocas se ven muy suaves y sin definición; la nieve está definida demasiado dura". Comparado desde las mismas cámaras (`capturas/roca-definida-antes-despues.jpg`, `borde-nieve-anchos.jpg`, `texturas-final-ajustada.jpg`).

- **Por qué la roca se veía suave**: a 20 m por mosaico, desde 170–600 m las fracturas de la textura ocupan pocos píxeles y el mipmap las promedia.
- **Corrección de la roca**:
  - **Capa macro de la misma textura a 80 m**, con muestreo aperiódico: placas y fracturas de decenas de metros, legibles a 200–800 m. Modula color y normal.
  - Detalle de 20 m con normal ×2, contraste del color ×1,6 y gradientes ×0,6 (mipmap algo más nítido a media distancia).
  - Sin textura nueva ni ruido procedural (uniforms `uRockLook`, `uRockMacro` en `src/shaders.ts`).
- **Corrección del borde de nieve**: la transición pasó de ~1 píxel (recorte duro) a ±0,02 de pendiente, sin bajar nunca de 1 píxel. Se compararon ±0,02 y ±0,04; con ±0,04 el borde ya queda borroso.
- **Costo de la capa macro** (misma página, alternando 2 veces): 3,22–3,55 ms con ella y 3,26–3,27 ms sin ella. Entre 0 y +0,3 ms, dentro de la variación entre corridas. Sin descarga extra.

### Optimización visual con técnicas de Three.js: roca *Marble Cliff 04*

Pedido: roca gris con fracturas, definida de cerca y a media distancia; nieve sutil; sin postprocesado, sin más geometría, sin librerías de terreno. Antes se probó un material de "caras planas" sobre REMA, que se descartó y se quitó del código (`src/facet-texture.ts` eliminado).

- **Textura de roca: *Marble Cliff 04*** (Poly Haven, Amal Kumar, CC0), **12,66 × 12,66 m reales** (tamaño publicado). Tiene bloques y fracturas grandes.
  - Se descartó ambientCG *Rock030*: es grano fino con vetas y, desde 170–600 m, se vuelve un ruido tipo "alfombra" con tinte verde oliva (`capturas/roca-rock030-descartada.jpg`).
  - Antes se usó *Marble Cliff 05* (20 m), que se veía suave a media distancia.
- **Color**: gris mineral. Se usa la luminancia de la foto (el mármol es crema), normalizada a una luminancia media lineal de 0,18 y levemente fría. Uniform `uRockTone` = (luminancia, fracción de color de la foto = 0).
- **Escala física**: detalle a 12,66 m y la misma textura a 90 m como capa media (muestreo aperiódico, sin repetición visible). Normal ×1, contraste ×1 y gradientes de mipmap estándar: con normal ×2 y gradientes ×0,6 se veía granulado.
- **Proyección**: biplanar por la normal REMA (sin el eje más débil, segundo plano solo si pesa ≥ 15 %). Sin triplanar completo y sin estiramiento en paredes.
- **Nieve**: sin cambios. Las ondulaciones de las vistas de nieve vienen del relieve REMA: se ven iguales con el detalle apagado (`capturas/nieve-origen-ondulaciones.jpg`). El microrelieve Snow007A ya es muy discreto (normal ×0,35, solo de cerca).
- **Nitidez**:
  - Anisotropía de las texturas KTX2 bajada a 8, la "moderada" del pedido. Con 16, 8 y 4 no hubo diferencia visible (`capturas/anisotropia-16-8-4.jpg`).
  - Lienzo: el nivel *alta* ya usa hasta dpr 2, limitado por la pantalla (aquí 1,25).
  - Niebla, geometría REMA, LOD y navegación sin cambios.
- **Comparaciones** desde las mismas cámaras: `capturas/roca-marble-cliff-04.jpg`; vista final con las 6 cámaras de prueba: `capturas/terreno-optimizacion-final.jpg`.
- **Costo de la capa media de 90 m** (alternando 2 veces): con ella 3,10 y 2,69 ms; sin ella 2,73 y 2,72 ms. Entre 0 y +0,4 ms, dentro de la variación entre corridas.

### Surcos del relieve en la roca y volumen en la nieve

Pedido: la roca se veía como una textura repetida y no se notaban los surcos ni las formaciones; la nieve se veía plana. Cambios uno por vez, desde las mismas cámaras.

- **Diagnóstico** (`capturas/roca-diagnostico-surcos.jpg`): los surcos están en el relieve REMA (se ven con la roca sin textura), pero la textura uniforme y la normal de la capa de 90 m los tapaban. Esa normal es un relieve inventado a la escala de los surcos reales.
- **Curvatura con signo del REMA** (`src/worker.ts`): media del entorno menos la altura, a 8 y 24 m. Se guarda en el canal B de la textura de luz, que estaba sin uso: 128 es plano, más es surco u hondonada, menos es cresta. No agrega descarga ni lecturas de textura: ese texel ya se leía.
- **Roca** (`uRockRelief`): surcos oscurecidos (×0,9) y crestas apenas aclaradas (×0,25, tope ×1,2). Se quitó la normal de la capa de 90 m: dos lecturas menos por píxel de roca. El albedo de 90 m se conserva, porque sin él la roca vuelve a verse uniforme.
  - Capturas: `capturas/roca-surcos-curvatura.jpg`, `roca-surcos-intensidad.jpg`.
  - Con las crestas a ×0,9 y tope ×1,7 las aristas quedaban como estelas blancas: `capturas/roca-estelas-antes.jpg` y `roca-estelas-despues.jpg`.
- **Nieve** (`uSnowRelief` = 1,5): con la misma curvatura, las hondonadas y los surcos quedan algo más sombreados y fríos y las lomas apenas más claras. Sin ruido.
- **Exposición** de 0,95 a 0,85: la nieve al sol quedaba en la zona que el tone mapping comprime y perdía volumen (`capturas/nieve-volumen-exposicion.jpg`). La roca y el mar se oscurecen apenas.
- **Costo** (misma página, alternando 2 veces la versión anterior y esta): 3,38–3,46 ms antes y 3,46–3,47 ms ahora. Sin diferencia medible. Vista final: `capturas/terreno-surcos-volumen-final.jpg`.
- **Sin blanco en la roca** (`uRockTone.z` = 0,3): las zonas claras del mármol de la foto llegaban a ~1,6 veces el gris medio y al sol se veían como un moteado blanco. Ahora solo se conserva el 30 % de lo que supera la media (`capturas/roca-sin-blanco.jpg`). El tono medio quedó después en 0,17 (ver "Roca pálida y borrosa → definida").
- **Interpretación**: la cobertura de nieve y roca, los tonos y el sombreado son una representación artística sobre el relieve REMA, no un dato observado. La curvatura sí sale de las alturas REMA.

### Dirección de arte "Detailed Cozy 3D", fase 1: roca sólida y luz fría

- **Luz** (`src/main.ts`, estilo Interpretación; `capturas/luz-relleno-cielo-frio.jpg`):
  - Cielo #cfe0ee → #bcd4ec y suelo #8796a0 → #9aaab6, con intensidad 1,05 → 1,35. Las caras de roca a la sombra pasan de casi negras a gris azulado con detalle, y las sombras de la nieve quedan azuladas.
  - Sol #fff0d8 → #fff6ea, intensidad 2,6 → 2,9: separa mejor los planos al sol de los que están a la sombra.
  - Sin postprocesado ni luces nuevas.

- **Roca pálida y borrosa → definida** (`capturas/roca-corregido-vs-prueba-c.jpg`, `roca-fracturas.jpg`):
  - El primer intento contra el moteado blanco (contraste 0,4, mipmap ×2) dejó la roca pálida y borrosa, y se descartó.
  - Con la textura nítida (contraste 1, normal 0,9) quedaba un grano sin fracturas legibles. La normal del mármol es de alta frecuencia a cualquier escala; se probaron 12,66 m, 30 m y una capa de 35 m.
  - La prueba "C" sí se veía definida, por su relieve de detalle generado en el navegador (caras angulosas de 2–15 m, mosaico de 97 m, aperiódico, 0 bytes de descarga). Ahora ese relieve se aplica **solo a la roca** del material Corregido (`uRockFrac` = 1,7), sin las ondas de nieve de "C", sobre el color real de *Marble Cliff 04*, con los surcos REMA y solo de cerca. Es una interpretación artística: no son fracturas medidas.
  - El moteado blanco lo evita `uRockTone.z` = 0,3 (zonas claras de la foto al 30 %), con tono medio 0,17.
- **Agua** (`capturas/agua-color-reflejo-ondas.jpg`):
  - Azul petróleo oscuro: profundo #14303f → #0b2a35, costero #2b5a6b → #1b4b57.
  - Reflejo aproximado del cielo: Fresnel de Schlick con un color fijo, sin reflejos planares ni env map, intensidad 0,3. Con 0,55 el horizonte quedaba gris.
  - Ondas: solo la normal, sin mover geometría ni simular. Son 5 ondas direccionales de 6 a 41 m, con la velocidad de fase de aguas profundas ×0,5. Cada onda se apaga por debajo de ~10 píxeles, para evitar franjas a la distancia. Rugosidad 0,16 → 0,22, para brillos más contenidos.
  - `uSeaLook` = (pendiente 0,05, reflejo 0,3, velocidad 0,5, rugosidad 0,22). Es el mismo código en el terreno costero y en el plano del mar.
- **Movimiento del agua y render a demanda** (`src/main.ts`): antes la escena no se redibujaba en reposo. Ahora, con el estilo Interpretación, se redibuja a ~24 cuadros/s en reposo para mover el agua; con la cámara en movimiento sigue al ritmo normal. No anima con `prefers-reduced-motion`, con la pestaña oculta ni en el estilo Base. **Costo**: en reposo la GPU deja de estar inactiva, unos 24 × ~7 ms ≈ 17 % de ocupación en este equipo.
- **Espuma**: sin cambios. Se compararon la actual, a la mitad y sin espuma, y la diferencia es mínima: ya es angosta y cortada.
- **Costo por cuadro** (GPU, consultas de tiempo, mediana en 4 cámaras cercanas y de costa, alternando 3 veces la versión sin fracturas ni ondas y la nueva): antes 6,53–6,64 ms, ahora 6,61–7,20 ms, o sea **+0,1 a +0,6 ms**. Los valores absolutos son mayores que los de la tabla porque las cámaras son más cercanas, con todo el detalle; sirven solo para comparar.
- Vista final: `capturas/fase1-roca-agua-final.jpg`.
- **Roca sin cambios de color** (`capturas/roca-sin-cambios-color.jpg`): las manchas claras venían de la capa de color de 90 m, y las bandas oscuras del oscurecido de surcos (0,9). Se apagó la capa de 90 m (dos lecturas menos) y el oscurecido de surcos bajó a 0,4, con crestas a 0,1. La roca queda en un gris parejo y las formas las dan la luz sobre las fracturas y el relieve.
- **Montaña pálida → nieve limpia** (`capturas/palido-diagnostico.jpg`, `nieve-volumen-suave.jpg`): se compararon cuatro factores, uno por columna (volumen de nieve, exposición, relleno). El que agrisaba la montaña era el tono de volumen de la nieve (0,80/0,87/0,97 en todas las hondonadas). Ahora el tono es 0,90/0,94/1,00 y se aplica solo en surcos marcados (umbral 0,15): la nieve queda blanca y el volumen se lee en los surcos.

### Estilizado: luz en bandas, menos rugosidad y nieve limpia

Pedido: más estilizado y menos rugoso, mejor nieve. Hasta acá la fase 1 se había aplicado en partes sueltas, con luz realista (Lambert) y roca con mucha rugosidad generada. Capturas: `capturas/estilizado-luz-bandas.jpg`, `estilizado-nieve-lomitas.jpg` y `estilizado-antes-despues.jpg`.

- **Luz en bandas** (`stylRamp`, `uStylize.x` = 1): la luz directa usa tres zonas con transiciones suaves (sombra, medio tono, luz) en lugar del degradado de Lambert. Se aplica dentro de la luz de Three.js, sin pases nuevos ni postprocesado.
- **Menos rugosidad en la roca**:
  - Normal REMA de un mipmap más grueso (`uStylize.y` = 1,5, unos 11 m), solo para sombrear y clasificar. La geometría y el LOD no cambian.
  - Fracturas generadas de 1,7 a 0,6 (`uRockFrac`) y normal de la textura de 0,9 a 0,4.
- **Nieve limpia**:
  - Las "lomitas" no venían de las normales (sin cambio con suavizado de hasta 64 m) ni de la sombra precalculada. Venían del sombreado por cavidades a 24 y 64 m, más el volumen por curvatura agregado antes.
  - Ahora: cavidades en la nieve al 20 %, volumen por curvatura apagado (`uSnowRelief` = 0) y normal de la nieve más suavizada (`uStylize.z` = 3, unos 32 m). Microrelieve Snow007A de 0,35 a 0,1.
  - El volumen de la nieve lo dan las formas grandes del REMA bajo la luz en bandas.
- **Costo** (GPU, consultas de tiempo, 4 cámaras, alternando 3 veces): antes 7,32–7,61 ms, ahora 7,24–7,84 ms. Sin diferencia medible.

### Estado actual: luz realista del commit 005af20 y nieve con textura

Pedido: volver a una iluminación realista como la del commit anterior y darle más textura a la nieve.

- **Luz**: los valores son idénticos a los del commit 005af20 (cielo #cfe0ee, suelo #8796a0 a 1,05; sol #fff0d8 a 2,6; exposición 0,95), sin luz en bandas (`uStylize.x` = 0). Las variantes de luz fría con relleno y de luz en bandas quedan descartadas; el código de las bandas se conserva apagado.
- **Se mantiene del estilizado**: normales REMA suavizadas para el sombreado (roca 1,5 y nieve 3), fracturas de roca a 0,6, roca gris pareja y agua.
- **Textura de nieve** (`capturas/nieve-textura-legible.jpg`): Snow007A a 2 m por mosaico no se veía desde 200 m o más, porque quedaba por debajo de un píxel. Ahora va a 8 m por mosaico con intensidad 0,6 y se lee como grano de viento, sin volver a las lomitas. La escala es artística: la fuente no publica el tamaño real.
- Vista final con las 6 cámaras de prueba: `capturas/terreno-final-luz-commit.jpg`.

### Día despejado e interfaz ocultable

- **Luz nublada → día despejado** (`capturas/luz-niebla-distancia.jpg`, `luz-dia-despejado.jpg`):
  - La niebla no era la causa: empieza a 4,4 km y alejarla casi no cambió la imagen.
  - El aspecto de cielo cubierto venía del balance: mucho relleno de cielo (1,05) respecto del sol (2,6).
  - Ahora: sol #fff3e0 a 3,3, relleno #b3d3f0 a 0,75, y cielo de fondo, niebla y reflejo del agua #a6c8e6. Mismo modelo de luz realista, sin bandas ni postprocesado.
- **Ocultar la interfaz** (`capturas/interfaz-oculta.jpg`):
  - Botón "Ocultar interfaz" arriba a la derecha, o tecla **H**. Oculta el panel, las métricas y el marcador de la base, y deja solo el botón ("Mostrar interfaz"), semitransparente.
  - Es accesible: botón con `aria-pressed`, `aria-keyshortcuts`, foco visible y 44 px de alto para uso táctil.
  - Con `?ui=0` (modo captura) tampoco se muestra el botón.

### Nieve más creíble (y un intento de costa reemplazado)

- **Costa**: en esta línea de trabajo se probó aplanar el relleno de mar de REMA en el worker (`capturas/costa-rasante-antes.jpg`, `costa-rasante-escalones-descartado.jpg`, `costa-rasante-despues.jpg`). Ese cambio **no quedó en el código**: lo reemplazó la costa vectorial y el océano nuevo del commit 27c8bef. Las capturas quedan solo como registro.
- **Nieve** (`capturas/nieve-volumen-textura.jpg`):
  - Volumen: normal REMA de la nieve suavizada 1 (antes 3, unos 32 m, que la aplanaba) y oclusión de hondonadas al 50 % (`uSnowLook.y`).
  - Textura: Snow007A a 5 m con intensidad 1, escala artística.
  - Se probaron destellos de cristales con un hash (`nieve-volumen-destellos.jpg`); se veían como papelitos y se descartaron.
- **Costo de la nieve** (GPU, 4 cámaras, alternando 3 veces): antes 6,59–7,29 ms, ahora 6,59–7,14 ms. Sin diferencia medible y sin descarga extra. Los valores de nieve están en el código desde el commit 27c8bef.
- Vista final: `capturas/costa-nieve-final.jpg`.

### Costa sin "dientes", fondo bajo el agua y agua transparente en la orilla

- **Dientes en la costa** (`capturas/costa-dientes-antes.jpg`, `costa-dientes-alambre.jpg`, `costa-dientes-despues.jpg`):
  - Eran geometría: al recortar los triángulos contra la costa, los bordes quedaban a la altura de la cresta y los vértices del lado del mar en el relleno de REMA. Se formaba una "cerca" de triángulos verticales finos.
  - Ahora `meshFrom` (`src/worker.ts`, `SEABED`) ya no recorta. Las celdas de costa se dibujan enteras: la tierra queda al menos 0,3 m sobre el mar, el mar baja como fondo y la línea de costa sale de la intersección con el plano del agua.
  - El recorte anterior queda en el código detrás de `SEABED = false`.
- **Fondo bajo el agua** (reconstrucción artística, **no es batimetría medida**):
  - Franja de 100 m desde la costa. La profundidad crece con la distancia hasta 30 m, donde empalma con un piso plano a 30 m (`ocean.ts`, 2 triángulos).
  - Las celdas enteramente bajo el agua van en bloques de 16 m y la costa a 8 m.
  - En el shader, bajo el nivel del mar el terreno se pinta como grava y roca oscuras que se absorben hacia el azul con la profundidad.
- **Agua transparente en la orilla** (`capturas/fondo-agua-transparente.jpg`): la opacidad del `Water` depende de la cercanía a la costa (canal G de la textura de luz del terreno). Es 0,22 en la orilla y opaca a ~140 m. Sin pases nuevos.
- **Orillas más claras** (`capturas/orillas-claras.jpg`): con fondo casi negro y opacidad 0,42 las orillas se veían muy oscuras. Ahora el fondo es grava y arena húmedas (#7f8a84), pasa a gris verdoso (#3a4644; el turquesa se veía muy azul, `capturas/orillas-menos-azul.jpg`) hacia los 6 m y a azul profundo hacia los 26 m (`uSeaBed`, `uSeaBedDepth`), y el agua tiene opacidad 0,22 en la orilla.
- **Orillas, ajuste final** (`capturas/orillas-sin-franja-oscura.jpg`): la franja a la altura del agua se pintaba con el color del mar profundo y dibujaba un borde oscuro en toda la costa; ahora usa el color del fondo (`uShoreBand`). Fondo de orilla #a3aca6, intermedio #5d6965 a 9 m, azul profundo a 30 m, agua al 0,18 en la orilla.
- **Orilla menos transparente** (`capturas/orilla-opaca-clara.jpg`): con opacidad 0,18 el agua de la orilla mostraba demasiado el fondo y se veía oscura. Ahora la opacidad es 0,6 y la superficie tiene un tinte claro de agua poco profunda (#4f7178, 45 % en la orilla; `uShoreLook`, `uShallow` en `ocean.ts`).
- **Mallas re-horneadas** en las 13 bases: `node scripts/rehornear-brown.mjs <base>`, un proceso por base, porque varias en el mismo proceso falla. LOD total 12,8 → 14,3 MB (+11 %); Brown 4 m: 842 → 861 KB.
- **Costo** (GPU, 4 cámaras, alternando 3 veces agua opaca y transparente): 5,76–7,18 ms contra 6,43–7,04 ms, sin diferencia medible.
- **Pendiente**:
  - ~~La pared de hielo toca el agua con un escalonado de 8 m~~: resuelto en "Costa sin escalones", más abajo.
  - ~~Láminas en Carlini~~: eran en gran parte cámaras de prueba dentro del hielo, no artefactos del terreno.

### Costa gradual y reflejo del sol (GLSL)

- **Transparencia de la costa más gradual** (`capturas/costa-transicion-gradual.jpg`): la opacidad y el tinte del agua siguen una curva más extendida desde la orilla (`uShoreCurve` = 0,6 en `ocean.ts`). El fondo pasa a gris verdoso hacia los 16 m (antes 9) y a azul profundo a los 30 m (`uSeaBedDepth`). Ya no se marca una banda.
- **Sol en el agua** (`capturas/agua-reflejo-sol.jpg`): el `Water` multiplicaba su brillo especular por la imagen reflejada y el sol casi no aparecía. Ahora suma en GLSL dos lóbulos: el disco del sol reflejado (exponente 900) y el camino de luz sobre las ondas (exponente 48), con la normal de las ondas del propio `Water` (`uSunGlint` = 1).
- **Sol en la nieve** (`capturas/nieve-brillo-sol.jpg`): dentro de la luz directa del sol se agregan un satinado amplio (0,12, exponente 24) y destellos finos que salen del microrelieve de la textura de nieve (2,5, exponente 600, solo de cerca), y solo en la nieve (`uSnowGlint`). No es un ruido inventado: los destellos aparecen donde la normal de la textura apunta al sol.
- **Reflejo del sol visible desde más vistas** (`capturas/agua-reflejo-sol-visible.jpg`): con dos lóbulos solo se veía mirando justo hacia el sol y con su misma inclinación. Ahora son tres (`uGlintLobes` = amplio 0,18 · camino de luz 0,6 · disco 6): el amplio aclara el agua del lado del sol desde casi cualquier vista.
- **Hora como deslizador** (`capturas/deslizador-hora.png`): el panel Sol y hora tiene un deslizador "Hora (UTC)" de DialKit, de 0 a 23,75 h en pasos de 15 min, que mueve el sol en continuo. Reemplaza los botones −1 h / +1 h; queda "Ahora". Fecha y hora siguen editables y se sincronizan con el deslizador.
- **La nieve refleja el sol como la nieve real** (GLSL, en la luz directa del sol; `capturas/nieve-cristales-sol.jpg`). Reemplaza los destellos anteriores, que salían de la textura.
  - Satinado especular amplio (0,12, exponente 24).
  - **Dispersión hacia adelante** (`uSnowFwd` = 0,6): la nieve brilla más mirando hacia el sol con ángulo rasante.
  - **Cristales de hielo** (`uSnowGlint.z` = 90, densidad 0,35). Celdas del tamaño de ~1,5 píxeles (por el lado corto del píxel; con el lado largo salían rayitas), estables al acercarse (potencias de 2). Cada cristal tiene una cara orientada al azar (±0,45 alrededor de la normal), y solo brilla si refleja el sol hacia la cámara (exponente 1500). Por eso titilan al moverse.
  - La nieve al sol ya está casi en blanco (237/255 tras el tone mapping), así que el reflejo se ve sobre todo como destellos. Con intensidad 4 los cristales no llegaban al blanco.
  - **Costo** (GPU, 4 cámaras, alternando 3 veces): 6,10–6,20 ms apagado contra 6,09–6,27 ms encendido. El código corre en los dos casos (se apaga por parámetro), pero es poca aritmética y sin texturas.
- **Niebla**: se probó quitarla. Al sacarla aparecía una línea oscura en el horizonte (el borde del plano del océano) y quedaba a la vista el terreno exterior. A pedido se volvió a la niebla original. Los bordes con `fogColor` del océano y del terreno exterior quedaron protegidos con `#ifdef USE_FOG`, así que ya se puede desactivar sin errores de shader.
- **Pendiente**: en el borde del recorte, el terreno exterior de 60 m se ve como una silueta azul oscura (se ve igual con niebla y sin ella).
- Vista final: `capturas/sol-costa-final.jpg`.

### Costa sin escalones (vértices de costa sobre la línea ADD)

- **Causa**: no eran los chunks ni el LOD. Los bloques de tierra firme conservan el perímetro a resolución completa. El problema estaba en el path `SEABED` de `meshFrom` (`src/worker.ts`): clasificaba cada vértice de la malla de 8 m como tierra o mar y dibujaba las celdas enteras, así que el contorno seguía la grilla. En un acantilado de 20–30 m la línea de agua queda casi encima del vértice de mar, por eso la escalera se veía tan marcada.
- **Corrección**, en el preprocesado y sin vértices nuevos:
  - Los vértices de costa (tierra con un vecino de mar o mar con un vecino de tierra) se corren en horizontal hasta la costa ADD. Para eso se usa la distancia con signo que el worker ya tiene en memoria, con el gradiente por diferencias centrales y un tope de 0,45 celdas (3,6 m a 8 m).
  - La altura no cambia.
  - Los vértices del borde de un bloque quedan fijos para no abrir grietas con el LOD instanciado.
  - Una pasada final devuelve a la grilla los vértices de triángulos que quedaban invertidos. En Carlini eran 83 de 125.630 (0,07 %); quedaron 0, y también 0 en Brown.
  - Los bloques de fondo de 2×2 celdas no se arman sobre vértices desplazados, porque abrirían grietas con las celdas finas vecinas.
- **Antes / después** desde la misma cámara de Carlini (−250, 200, −1140 → −290, 10, −1250):
  - `capturas/costa-escalonada-antes-carlini.jpg`
  - `capturas/costa-escalonada-solo-tierra-carlini.jpg`: un primer intento que movía solo los vértices de tierra. No alcanzó, porque en los acantilados manda el vértice de mar.
  - `capturas/costa-escalonada-despues-carlini.jpg`
- **Costo** (13 bases re-horneadas):
  - Mallas LOD: 14,3 → 15,6 MB de descarga (+9 %); Brown 4 m: 861 → 950 KB. Las coordenadas fraccionarias comprimen peor y hay menos bloques de fondo de 2×2.
  - Triángulos: Carlini 4 m pasó de 125.630 a 130.178 (+3,6 %).
  - Sin costo por cuadro: no cambia ningún shader ni pase.
  - GPU sin medir.

### Agua sedosa y sin repetición (`src/ocean.ts`)

- **Causa**:
  - El `Water` de Three.js suma cuatro lecturas del mapa de normales. Dos tienen casi la misma escala (103 y 107 m), van alineadas a los ejes y se desplazan juntas: dibujan un patrón cada ~105 m.
  - Además, la textura trae un rizado fino que se lee a cualquier escala y da un aspecto de papel aluminio.
- **Cambio**: se reemplaza `getNoise` en los tres niveles de calidad.
  - El dominio se curva con dos senos lentos, así que las crestas nunca vuelven a alinearse.
  - Las capas usan escalas no conmensurables (211 y 83 m), giradas 18° y −65°, y se leen desde un mipmap más suave (bias 2,5), lo que quita el rizado.
  - En escritorio hay una tercera capa fina (31 m, 22 %) que se apaga sola cuando un texel queda más chico que un píxel, así no aparece moiré a lo lejos.
  - Las ondas son más bajas: `uSilk` 0,78 → 0,5 (el original de Three.js es 1,5), y la distorsión del reflejo pasa de 1,05 a 0,6.
- **Antes / después** (Brown, misma cámara y misma fase del oleaje):
  - lejos: `capturas/agua-sedosa-antes-lejos.jpg` → `agua-sedosa-despues-lejos.jpg`
  - cerca: `capturas/agua-sedosa-antes-cerca.jpg` → `agua-sedosa-despues-cerca.jpg`
  - hacia el sol: `capturas/agua-sedosa-antes-sol.jpg` → `agua-sedosa-despues-sol.jpg`
- **Costo**:
  - Escritorio alta: de 4 a 3 lecturas de textura.
  - Móvil y calidad baja: siguen en 2.
  - GPU sin medir.
- **Sin mosaico** (`capturas/agua-mosaico-antes-cerca.jpg` → `agua-mosaico-despues-cerca.jpg`, `agua-mosaico-despues-sol.jpg`):
  - Problema: con las capas giradas y el dominio curvado seguía viéndose la misma porción de textura cada 211 y 83 m; de cerca, los mismos arcos de onda.
  - Ahora cada capa usa muestreo estocástico (técnica "texture repetition" de Íñigo Quílez). Un ruido suave elige un desplazamiento al azar por zona (~1,7 repeticiones de textura) y se funden dos lecturas.
  - Se usa `textureGrad` con las derivadas de la uv continua, así no quedan costuras de mipmap. El bias de 2,5 se mantiene escalando las derivadas.
  - Para comparar, `#define SILK_STOCH 0` vuelve a la lectura simple.
  - Costo: escritorio alta pasa de 3 a 5 lecturas de textura; móvil y calidad baja, de 2 a 4. Se suma un ruido de valor (4 hashes) por capa. GPU sin medir.
- **Agua, no espejo** (`capturas/agua-espejo-antes.jpg` → `agua-espejo-despues.jpg`, `agua-espejo-despues-cerca.jpg`):
  - Con ondas tan bajas, el agua reflejaba como un espejo. Además, el `Water` deforma el reflejo con 0,001 + 1/distancia, que a 1–2 km es casi nada, así que las montañas se reflejaban nítidas.
  - Ahora la deformación lejana es 0,04 y el reflejo se estira ×3 en vertical, como en el agua real (`uRipple`).
  - Las ondas son más marcadas: `uSilk` 0,9, distorsión 1,4 y bias 1,5. El mosaico no volvió, gracias al muestreo estocástico.
  - Solo cambian valores y una multiplicación en el shader, sin lecturas nuevas.
- **Que parezca agua** (antes: `capturas/agua-vetas-despues.jpg`, `agua-vetas-despues-cerca.jpg` y `agua-vetas-despues-altura.jpg`; después: `agua-real-despues.jpg`, `agua-real-despues-cerca.jpg` y `agua-real-despues-altura.jpg`, desde las mismas cámaras):
  - **Fresnel de agua**: el `Water` usa un reflejo base de 0,3 más un gris fijo de 0,1, y se veía gris metálico desde cualquier ángulo. Ahora es 0,02 y 0 (`uWater.x`, `uWater.y`): mirando hacia abajo se ve el color profundo (#103a42) y al ras del horizonte, el reflejo.
  - **Sin luz difusa**: el `Water` también suma la luz difusa del sol ×0,3, como si el agua fuera una superficie mate. Con el reflejo bajo, el agua quedaba marrón oliva (`capturas/agua-real-marron-descartado.jpg`). Ahora es ×0,03 (`uWater.z`).
  - **Se descartaron las vetas largas** (ver el punto siguiente). Volvió la forma anterior: capas de 211 y 83 m giradas entre sí, más la capa fina de 31 m en escritorio, `uSilk` 0,9 y bias 1,5.
  - **Sin mosaico**: la capa fina de 31 m también pasa por el muestreo estocástico. Antes se leía directo y se repetía cada 31 m.
  - Costo: escritorio, 6 lecturas de textura; móvil y calidad baja, 4. GPU sin medir.
- **Estado actual: textura azul verdosa con capas cruzadas y sedosa** (`capturas/agua-cruzada-arriba.jpg`, `agua-sedosa2-antes-cerca.jpg` → `agua-sedosa2-despues-cerca.jpg`, `agua-sedosa2-despues.jpg`, `agua-sedosa2-despues-arriba.jpg`):
  - Las olas calculadas (los dos puntos siguientes) se descartaron: desde arriba se cruzaban en una trama de rombos ("cubos"). Volvió la textura de olas de la versión azul verdosa, con su Fresnel de agua.
  - **Movimiento y sin motivo repetido**: en cada escala se suman dos lecturas de tamaño y giro distintos (211 y 163 m; 83 y 67 m) que avanzan en direcciones opuestas, a ~2–3 m/s. Su cruce cambia de forma con el tiempo y nunca repite el mismo dibujo. Cada lectura sigue siendo estocástica.
  - **Más sedosa**: bias 2,3 (antes 1,5), capa media al 20 % (antes 27 %), capa fina de 31 m al 7 % (antes 22 %) y `uSilk` 0,8. Con 0,5 parecía un espejo; con 0,8 el reflejo de las montañas sigue quebrado.
  - **Costo**: escritorio, 10 lecturas de textura (4 capas estocásticas de 2, más la fina); móvil y calidad baja, 6. GPU sin medir.
- **Ondas más grandes, sin turbulencia ni aspecto viscoso** (`capturas/agua-viscosa-antes-cerca.jpg` → `agua-viscosa-despues-cerca.jpg`, `agua-viscosa-antes-sol.jpg` → `agua-viscosa-despues-sol.jpg`, `agua-viscosa-despues.jpg`):
  - **Turbulencia**: las ondas chicas estaban muy juntas y las capas cruzadas avanzaban en direcciones opuestas. Ahora todas las capas son 2,5 veces más grandes (`SILK_SCALE`: 527/407/207/167/77 m) y avanzan dentro de ±30° de un mismo viento, a 1,2–3 m por unidad de tiempo (las grandes, más rápido; `SILK_SPEED`).
  - **Viscosidad**: con bias 2,3 las ondas se veían borrosas, como gel, y el brillo del sol era ancho y blando (exponente 65), como un líquido aceitoso. Ahora el bias es 1,4, el brillo es nítido (exponente 220, intensidad 2) y la capa fina pesa 12 %.
  - Sin cambios de costo respecto del punto anterior.
- **Olas procedurales — descartado** (antes: `capturas/agua-real-despues*.jpg`; después: `agua-olas-despues.jpg`, `agua-olas-despues-cerca.jpg` y `agua-olas-despues-altura.jpg`, desde las mismas cámaras):
  - **Causa**: todo el oleaje salía de una sola imagen de olas (`waternormals.jpg`) que se deslizaba. Aun mezclada por zonas, se reconocían las mismas formas, y como la imagen solo se trasladaba (1–2 m/s), las olas no cambiaban de forma: se veía estático.
  - **Cambio**: `getNoise` suma 24 olas direccionales calculadas en el shader (14 en móvil), sin textura.
    - Cresta aguda con seno exponencial. Largos de 170 m hacia abajo, cada uno ~16 % más corto con variación al azar (`SEA_LJIT`), porque con una progresión exacta las olas cruzadas armaban una trama en rombos.
    - Direcciones dentro de ±1,9 rad alrededor del viento. Pendiente repartida entre muchas olas (`SEA_STEEP` 0,13, `SEA_SF` 0,965): con la primera ola dominante, desde altura se veían rayas paralelas (`capturas/agua-olas-rayas-descartado.jpg`).
    - Cada ola viaja a la velocidad del mar real para su largo, ω = √(g·k), y corre el dominio de la siguiente (`SEA_DRAG` 0,9). Así la superficie cambia de forma en lugar de deslizarse.
    - Las olas más cortas que ~4 píxeles se apagan, para que no titilen a lo lejos.
    - En escritorio, un rizo fino de textura estocástica de 13 m (20 %) agrega irregularidad de cerca.
  - **Costo**: 24 iteraciones de seno, coseno y exponencial por píxel de agua en escritorio (14 en móvil), más 2 lecturas de textura en escritorio y ninguna en móvil. **GPU sin medir**: falta medirlo en hardware real, sobre todo en móvil, que es donde más puede pesar.
- **Sin grilla de brillos desde altura — descartado con las olas procedurales** (`capturas/agua-patron-antes-alto.jpg` → `agua-patron-despues-alto.jpg`, `agua-patron-antes-medio.jpg` → `agua-patron-despues-medio.jpg`, `agua-patron-despues-cerca.jpg`; mismas cámaras y misma fase):
  - **Causa**: las olas de 20–40 m se dibujaban hasta medir ~4 píxeles, y sus cruces formaban una trama pareja de puntos claros. Además, el oleaje era idéntico en todo el mar.
  - **Las olas se apagan antes**: entre 25 y 10 píxeles de largo (`SEA_FADE`). El mar lejano queda liso, como el real.
  - **Parches de mar calmo y picado**: de ~520 y ~190 m (`SEA_PATCH`), derivan con el tiempo. Afectan a las olas de menos de 120 m (de 0,2× a 1,3×, `SEA_CALM`) y al rizo fino; el mar de fondo no cambia.
  - **Costo**: dos ruidos de valor por píxel, sin lecturas de textura nuevas. GPU sin medir.
- **Vetas largas y más oleaje — descartado** (antes: `capturas/agua-espejo-despues.jpg` y `agua-espejo-despues-cerca.jpg`; después: `agua-vetas-despues.jpg`, `agua-vetas-despues-cerca.jpg`, `agua-vetas-despues-altura.jpg` y `agua-vetas-despues-sol.jpg`, desde las mismas cámaras):
  - "Sedosa" quería decir vetas largas y menos detalle chico.
  - Las dos capas se estiran a lo largo de las crestas: 600 × 220 m y 260 × 100 m (`SILK_S1`, `SILK_S2`). Van casi alineadas (18° y 28°, como un mismo viento) y avanzan a través de las crestas.
  - La pendiente se corrige por el estiramiento: es más suave a lo largo de la veta.
  - Se quitó la capa fina de 31 m. Escritorio y móvil usan la misma función: 4 lecturas de textura, una menos que antes en escritorio.
  - Oleaje más alto: `uSilk` 0,9 → 1,35. El dominio se curva con 40 m de amplitud (antes 21), así que las vetas ondulan. Bias 1,75.

### Volumen de la nieve y bordes de acantilado (`src/snow-volume.ts`, `MAT_N` en `src/shaders.ts`)

Es una reconstrucción artística: las acumulaciones no son elevaciones medidas. No cambian ni los datos REMA, ni la textura de alturas, ni `heightsM`, ni la colisión de la cámara. Se apaga con `?nieve=plana` o con `uSnowDisp.w = 0`.

- **Relieve de nieve 256² generado al cargar** (0 bytes de descarga, RGBA8 con mipmaps, ~0,35 MB de GPU). R = altura (acumulaciones suaves y redondeadas, apenas alargadas); G y B = su gradiente. Una sola textura compartida por todos los bloques y materiales.
- **Desplazamiento en el vertex shader**:
  - Hasta ±2 m: 4 m de amplitud con mosaico de 220 m (`uSnowDisp`).
  - Solo en pendientes de hasta ~40°, a más de 4–12 m de la costa, por encima del nivel del mar y a menos de 1,8 km de la cámara.
  - Es la misma función de la posición de mundo en los bloques LOD y en la malla costera: los vértices compartidos se mueven igual y no se abren grietas.
  - No se agregan triángulos.
- **Normal del mismo relieve en el fragment**:
  - La luz coincide con la forma, con lomas de ~15 m más (mosaico de 70 m, 0,9 m; solo en la luz).
  - Llega hasta ~50° de pendiente; con el corte a ~35°, la nieve de montaña quedaba sin efecto.
  - Se apaga entre 2 y 3,5 km.
- **Descartado**: crestas finas tipo sastrugi y ondulaciones de 37 m. La nieve se veía rayada (`capturas/nieve-rayada-descartado.jpg`).
- **Bordes verticales en acantilados**:
  - **Causa**: las caras de la malla entre la cima y el agua se clasificaban con la normal REMA cenital, que ahí dice "plano". Se pintaban de nieve, con vetas verticales.
  - **Corrección**: en la franja costera, si la cara es mucho más empinada que la normal REMA de 4 m, se trata como pared. La dirección horizontal sale del gradiente de la distancia a la costa (mipmap de ~64 m; con lecturas finas salían columnas facetadas). La cavidad, la curvatura y la sombra cenitales no se aplican en esas caras.
  - También, en paredes empinadas las cavidades ya no retienen nieve.
  - Antes y después: `capturas/nieve-pared-costa-antes.jpg` → `nieve-pared-costa-despues.jpg`, `nieve-acantilado-antes.jpg` → `nieve-acantilado-despues.jpg`.
  - Las manchas blancas en roca empinada de la vista B no cambian: son repisas que REMA mide casi planas.
- **Volumen**: `capturas/nieve-volumen-antes-a.jpg` → `nieve-volumen-despues-a.jpg`.
- **Costo** (Brown 4 m, banco de 5 poses, GPU integrada; alternando con y sin el código compilado):

  | | Sin el código | Con el efecto |
  |---|---|---|
  | GPU, mediana | 4,60–4,90 ms | 4,99 ms |
  | Triángulos y draw calls | | idénticos |
  | Memoria | | +0,35 MB (textura) |

  - Con la luz del relieve en todos los niveles LOD costaba +0,7 ms. Por eso la parte del fragment (`SNOW_VOL_FRAG`) va solo en los niveles cercanos, y el desplazamiento en todos.
  - **Pendiente**: medir en móvil.
- **Que el volumen se note** (`capturas/nieve-volumen-visible-antes.jpg` → `nieve-volumen-visible-despues.jpg`, `nieve-volumen-visible-antes-cerca.jpg` → `nieve-volumen-visible-despues-cerca.jpg`, `nieve-volumen-visible-campo.jpg`): con el relieve solo, el cambio no se veía, por tres motivos.
  - **Nieve casi saturada al sol**: el blanco llegaba a ~237/255 y una loma apenas cambiaba el tono. `uSnow` pasa de #f3f6f8 a #e3e7ea.
  - **Normal REMA de la nieve muy suavizada**: borraba las formas reales de 8–30 m del dato. `uStylize.y` pasa de 1,5 a 0,5 y `uStylize.z` (suavizado extra solo en la nieve) de 1 a 0.
  - **Hondonadas**: el sombreado pasa del 50 al 100 % (`uSnowLook.y`).
  - **Costo** (misma sesión, otro tamaño de lienzo): 4,03–4,11 ms con el relieve contra 3,80–3,82 ms sin su código. Apagar el suavizado extra de la nieve ahorra una lectura de textura por píxel.
- **Sin bordes dentados ni cuadrados; estado final** (`capturas/nieve-volumen-final-q.jpg`, `nieve-volumen-final-a.jpg`):
  - **Probado y descartado: espesor de la nieve sobre la roca** (`capturas/nieve-bordes-dentados-descartado.jpg`). Levantar la nieve 2,5 m sobre la roca en la geometría armaba bordes blancos dentados alrededor de cada roca (vértices cada 8 m). Hacerlo solo con la luz (gradiente por derivadas de pantalla) dejaba halos y escalones. Queda solo una sombra de contacto suave en la nieve junto a la roca y en la roca bajo el borde (`uSnowBank.y` = 0,18).
  - **Cuadrados en el volumen** (`capturas/nieve-cuadrados-antes.jpg`):
    - Con menos suavizado, de cerca se veían los texeles de 4 m de la normal y de la cavidad REMA: el filtrado bilineal se quiebra en el borde de cada texel y la luz lo marca.
    - De cerca (texel de más de ~1 píxel), la nieve lee normal y cavidad con filtrado bicúbico B-spline (`texBSpline`, 4 lecturas; lejos, 1).
    - El relieve generado usa interpolación quíntica (la cúbica también se quebraba en la grilla).
    - Se quitó la modulación por zonas con ruido de valor de 1900 m, que hacía cuadrados grandes.
    - Se probó también la sombra del sol con bicúbico (+4 lecturas): se descartó por costo.
  - **Volumen**: acumulaciones de 7 m de amplitud (±3,5 m, mosaico de 220 m) y lomas de 1,6 m (mosaico de 70 m, solo luz).
  - **Costo** (Brown 4 m, 5 poses, misma sesión): 5,30–5,44 ms con el efecto contra 4,74–4,76 ms sin su código (+0,55 ms, +12 %). Triángulos y draw calls idénticos. La vista cercana es la que más sube (+0,6 ms, por el bicúbico). Sin medir en móvil.
- **Espesor de la nieve, ahora sin segmentos** (`capturas/nieve-espesor-suave-q.jpg`, `nieve-espesor-suave-cerca.jpg`; antes, con segmentos: `nieve-bordes-dentados-descartado.jpg`):
  - La nieve vuelve a quedar 2,5 m por encima de la roca (`uSnowBank.x`) y las rocas asoman desde abajo.
  - **Qué causaba los segmentos**:
    1. El campo salía de la normal fina (4 m) con un borde angosto, así que el banco subía entero entre dos vértices.
    2. Las caras levantadas se iluminaban con la normal REMA, como si fueran planas.
  - **Ahora**:
    1. El campo (`snowThick`) sale de la lectura del mipmap 2 (~16 m) que el vertex shader ya hacía (0 lecturas extra), con un borde ancho (0,14–0,38): el banco sube a lo largo de varios vértices.
    2. La luz usa el gradiente de ese mismo campo, con 4 lecturas solo dentro del banco y cerca de la cámara, y las mismas máscaras de costa, nivel del mar y distancia que la geometría.
  - **Costo**: 5,32–5,33 ms contra 4,74–4,75 ms sin el código (+0,58 ms; el espesor suma ~0,03 ms). Triángulos idénticos.
- **Sombreado de forma de la nieve** (dirección artística; `capturas/nieve-forma-antes-s.jpg` → `nieve-forma-despues-s.jpg`, `nieve-forma-antes-a.jpg` → `nieve-forma-despues-a.jpg`, `nieve-forma-despues-q.jpg`):
  - **Problema**: aun con el relieve, el volumen no se leía en laderas abiertas. El relleno del cielo (0,75) y el blanco casi parejo emparejaban las caras al sol y en contra.
  - **Cambio**: según cuánto mira al sol la normal de la nieve (con relieve REMA, lomas y bancos), la nieve pasa de blanco a un azul grisáceo frío (`uSnowForm` = color lineal 0,48/0,58/0,74, intensidad 0,8; rango `uSnowFormR` = coseno con el sol de 0,35 a 1).
  - Con el rango de −0,25 a 0,85 solo se teñían las caras muy en contra, y con el sol a 42° casi no había ninguna.
  - Va en todos los niveles LOD (si no, habría un corte de color entre niveles). Usa la luz direccional del sol, sin lecturas de textura.
  - **Costo**: no medible (5,41–5,44 ms con y sin el sombreado, alternando 3 veces).
- **Sin patrones repetidos, sin cuadrados azules y costas suaves en todas las bases**:
  - **Cuadrados azules** (Belgrano II; `capturas/belgrano-cuadrados-antes.jpg` → `belgrano-cuadrados-despues.jpg`): venían de la variación de color de la nieve venteada, un ruido de valor de 1900 m con celdas de ~237 m alineadas a la grilla. En una meseta plana se veían como cuadrados. Ahora son dos lecturas del ruido, giradas y a escalas distintas (1900 y 1370 m), con un tinte más suave (+1 lectura de textura). Revisado también en Marambio y Brown.
  - **Patrón repetido de las acumulaciones** (`capturas/nieve-patron-antes.jpg` → `nieve-patron-despues.jpg`): el relieve (mosaico de 220 m) se repetía en toda la meseta. Ahora:
    - se lee con muestreo estocástico (técnica 3 de I. Quílez, como el agua), en el vertex shader y en el fragment;
    - hay zonas con y sin acumulaciones (`snowVolZone`, dos lecturas giradas del ruido).
    - Las derivadas para `textureGrad` se calculan fuera de los `if`.
  - **Costas en escalera en todas las bases** (`capturas/costa-escalera-antes-esperanza.jpg` → `costa-escalera-despues-esperanza.jpg`): la malla costera sigue la grilla (8 m, con refinamiento de 4 m en las celdas que cruzan el agua).
    - En el vertex shader (`COAST_RAMP_VERTEX`), en orillas bajas (menos de 5 m sobre el agua) y a menos de 10 m de la costa, la altura pasa a una rampa (`uCoastRamp`, pendiente 0,3) que cruza el nivel del mar donde la distancia con signo a la costa ADD vale 0. El agua corta el terreno en esa línea: la costa sigue el contorno real y no la grilla.
    - Los acantilados no cambian. Misma función en todos los bloques, así que no abre grietas. Cuesta 1 lectura por vértice y no se re-hornea nada.
    - Es una reconstrucción visual de la orilla; REMA no cambia.
  - **Dientes en orillas medianas** (`capturas/orilla-dientes-despues.jpg`): la detección de paredes ahora exige más de 6–12 m sobre el agua (antes 2–5 m). Queda un pie de nieve en la base de los acantilados altos (`capturas/orilla-acantilado-despues.jpg`).
  - **Costo** (Brown, 5 poses, lienzo 900×797, alternando 3 veces): 4,09–4,12 ms con todo el código nuevo de nieve y costa contra 3,55–3,56 ms sin él (+0,55 ms). Triángulos idénticos. Sin medir en móvil.
- **Nieve lisa otra vez y orillas sin dientes**:
  - **Nieve rugosa** (`capturas/nieve-rugosa-antes.jpg` → `nieve-rugosa-despues.jpg`): las manchas de 15–30 m salían de las lomas del relieve (mosaico de 70 m) y de la normal REMA casi sin suavizar, con las hondonadas al 100 %.
    - Las lomas se apagaron (`uSnowVolK.y` = 0) y las acumulaciones bajaron de 7 a 3,5 m.
    - La nieve usa la normal REMA con sesgo 2 (≈ 16 m; `uStylize.z`), y la roca conserva 0,5. Las hondonadas vuelven al 50 %.
    - De cerca, el bicúbico lee el mip 2 en vez del 0: si no, de cerca volvía la rugosidad.
  - **Dientes en la orilla** (`capturas/orilla-dientes-antes.jpg` → `orilla-dientes-despues.jpg`): los causaba la detección de paredes. En orillas bajas, las caras entre la tierra y el fondo se pasaban a roca y su silueta salía en dientes. Ahora solo cuenta como pared por encima de 2–5 m sobre el agua.
    - Primero se probó exigir desnivel en el relieve REMA suavizado, pero en el acantilado de la vista D no funcionaba (REMA rellena el mar).
    - Queda: una línea blanca fina en la base de los acantilados (`capturas/orilla-acantilado-despues.jpg`) y unas pocas puntas en tramos de 5–8 m.
  - **Paredes sin hielo**: las paredes detectadas ya no se pintan de hielo (`iceT *= 1 − wallK`); antes salían celestes verdosas.
- **Grano de la nieve más suave** (`capturas/nieve-grano-antes.jpg` → `nieve-grano-despues.jpg`): la textura rugosa era el normal map Snow007A (512², KTX2) a intensidad 1 con mosaico de 5 m, y de cerca se veía como papel arrugado. Ahora tiene intensidad 0,35 (`uStylize.w`) y mosaico de 2,5 m (`uTexScale.y`): un grano fino. Sin costo.
- **Que la nieve sobresalga de la roca con la malla actual — descartado**:
  - Se probó llevar los vértices a menos de 3,6 m del borde nieve/roca hasta él y levantar la nieve 1,5 m, sin triángulos nuevos.
  - Con vértices cada 8 m, las rocas más chicas que una celda se volvían astillas y los bordes quedaban cortados en triángulos (`capturas/nieve-canto-vertices-descartado.jpg`).
  - Con los intentos anteriores (espesor en la geometría, luz del banco y canto pintado), la conclusión es que hace falta geometría más fina en esos bordes. Estimación: a 2 m, solo dentro de 600 m de la cámara, entre +10.000 y +73.000 triángulos (hoy ~300.000) y +0,2 a +0,5 ms de GPU en escritorio, sin medir.
  - Estado actual: `capturas/nieve-estado-actual.jpg`.
- **Borde nieve-roca neto** (`capturas/nieve-borde-neto.jpg`): `uRockLook.w` pasa de 0,02 a 0,006. De cerca, la roca se desvanecía en la nieve como una mancha; ahora la nieve queda recortada sobre la roca. Sin costo.
- **Canto de la capa de nieve sobre la roca — descartado** (se veía muy raro: halos grises borrosos de varios metros alrededor de cada roca, `capturas/nieve-canto-halo-descartado.jpg`; las bandas definidas sobre la pendiente se estiran donde esta cambia despacio). Registro del intento (`capturas/nieve-canto-antes-a.jpg` → `nieve-canto-despues-a.jpg`, `nieve-canto-despues-cerca.jpg`, `nieve-canto-despues-q.jpg`):
  - Lo pedido: que la nieve sobresalga un poco de las rocas, como una capa apoyada encima. Con geometría, un escalón de 1–2 m sale en segmentos (vértices cada 8 m), así que se resolvió en el fragment, a resolución de píxel.
  - **Canto**: el último tramo de nieve antes del borde es la cara lateral de la capa, algo más oscura y fría, con una línea de luz en su borde superior.
  - **Sombra**: el primer tramo de roca después del borde recibe la sombra de esa capa.
  - Las bandas se definen sobre la misma clasificación nieve/roca (`tEdge`, umbral 0,32): `uSnowLip` = ancho del canto 0,05 · oscurecimiento 0,3 · ancho de la sombra 0,08 · intensidad 0,55.
  - Se probó medir la distancia al borde en metros con derivadas de pantalla: el término de paredes hace saltar `tEdge` justo en el borde y el canto quedaba en 1–2 píxeles.
  - No se aplica en caras de cierre ni en paredes de acantilado.
  - **Costo**: no medible (5,69–5,70 ms con y sin canto, alternando 3 veces). Sin lecturas de textura ni geometría nuevas.

### Probado y revertido: MARTINI, NoData y conciliación ADD/REMA

- **MARTINI** (Mapbox, mallas adaptativas por error de elevación) en los bloques de tierra firme:
  - Daba detalle de 4 m en las montañas con 45–70 % menos triángulos y la misma GPU (5,04–5,37 ms contra 5,37–5,39 ms).
  - En cambio, subía la memoria de geometría de 5 a 20,8 MB, y la diferencia visual era mínima.
  - Se revirtió y quedó el LOD instanciado original.
- **NoData (técnica de Giro3D)**: no aplica. Los recortes REMA v2 de las 13 bases tienen 0 % de NoData; lo que hay es mar rellenado por REMA (42–82 % del recorte).
- **Conciliación ADD/REMA** (la regla de `brown-reconcile.mjs` llevada a las 13 bases):
  - Agregaba de 0 a 4,2 km² de tierra donde REMA mide relieve conectado a la costa, a cambio de +1,3 MB de mallas.
  - Visualmente no se distinguía, así que se revirtió.

### Medido (Brown, Chrome, GPU integrada AMD Radeon, lienzo 1243×797 dpr 1,25)

| | Commit aprobado | Ahora |
|---|---|---|
| GPU por cuadro, mediana (alternando versiones; con *Rock 01*) | 2,03–2,51 ms | 2,80–3,24 ms (**+0,5 a +0,9 ms**, ≈ +30 %) |
| GPU por cuadro, mediana (versión con *Marble Cliff 05*) | — | 3,20–3,30 ms |
| GPU por cuadro, mediana (**versión actual, *Marble Cliff 04***) | — | **2,69–3,10 ms** (p95 3,6–4,4 ms) |
| GPU por cuadro, p95 | 2,83–3,02 ms | 3,9–4,4 ms |
| FPS reales (órbita, panel visible) | — | 59,9 con *Rock 01*; 53,2 con *Marble Cliff 05*; **59,8 con la versión actual** (cuadro medio 16,7 ms, p95 17,0 ms; tope de 60 Hz). Una primera corrida dio 20 FPS con pausas largas del panel y la prueba la marcó como no válida |
| Draw calls / triángulos (cámara media) | 4 / 312 k | 4 / 312 k |
| Texturas en memoria | 6 | 9 (+3 KTX2 de 512 px transcodificadas a BC7: ~0,33 MB de GPU cada una con mipmaps, ≈ 1 MB en total) |
| Memoria JS (heap usado, Chrome) | — | 59 MB |
| Descarga: texturas KTX2 | — | +219,1 KB (roca 67,2 + 92,0, nieve 59,9) |
| Descarga: transcodificador Basis (wasm + js, brotli) | — | +212 KB |
| Descarga: JS de la página (brotli) | 122 KB | 142 KB (+20 KB, sobre todo KTX2Loader) |
| Descarga: costa de Brown (4 m + 8 m) | 18 KB (máscara) | 55 KB (distancia con signo) |
| **Total adicional en escritorio (Brown)** | — | **≈ +490 KB** |

### Pendiente

- Junto a la costa el terreno dibuja el agua a la altura del relleno de REMA, que no es plano: en vistas rasantes aparecen superficies de agua inclinadas (estaba también en el commit aprobado). No se corrigió porque requiere tocar la geometría del mar.

## Pendiente (no medido o fuera de las fases 1 a 4)

- **FPS reales y celular**: no medidos (el panel frena `requestAnimationFrame`; el banco usa render sincrónico).
- La línea serpenteante sobre la nieve de Petrel también aparece en el dato (no es costa ADD); sin identificar.

### Costas compartidas (noviembre 2026)

La generación estándar es una superficie REMA continua que cruza el plano independiente del océano. ADD selecciona la franja de trabajo; no corta laderas elevadas ni sustituye muestras terrestres por profundidades artificiales. Las muestras elevadas fuera de ADD se conservan. El relleno oceánico sin batimetría se mantiene sumergido; no se presenta como fondo medido.

Solo las celdas que cruzan el nivel del mar incorporan sus muestras DEM nativas intermedias. Ambos lados de una arista toman la misma decisión de subdivisión. El interior y el sistema LOD mantienen su resolución. No se añaden caras verticales costeras: el cierre a −2 m queda restringido al perímetro exterior de la ventana de datos.

Regenerar: node scripts/coasts-all.mjs (incluye respaldo), o node scripts/rehornear-brown.mjs [bases]. Ambos usan el mismo método en las 13 bases. Los archivos costa-vector anteriores no se usan para recortar el relieve de producción.

Verificar: node scripts/check-continuous-coast.mjs [bases] comprueba que las alturas emergidas coinciden con el DEM, que no hay paredes internas y que no quedan bordes abiertos sobre el agua. Complementar con check-baked-geometry.mjs, check-coast-shaders.mjs y npm run build. La alineación exacta a ADD no es un criterio suficiente de compatibilidad vertical con REMA.

La validación numérica no sustituye la inspección visual o una medición de FPS en dispositivo.

### Mejora mínima de arquitectura y validación

El LOD usa heightfields indexados con un perímetro nativo idéntico en pasos 1/2/4/8. Las plantillas de chunks parciales tienen dimensiones reales, sin clamp de triángulos fuera del terreno. Los buffers nativos se comparten entre esas plantillas. El descarte por cámara y los materiales existentes se mantienen. Puede añadirse una llamada de dibujo cuando un chunk parcial es visible.

El Worker conserva las elevaciones válidas, utiliza cobertura medida alineada cuando está configurada y solo interpola huecos terrestres cerrados de hasta cuatro muestras, apoyados por ambos ejes. Rechaza bordes, costa y estimaciones incompatibles con un acantilado. Terrain.provenance identifica cada muestra reconstruida y las regiones pendientes. Terrain.grid mantiene la referencia espacial del DEM para futuras capas; no se implementaron materiales nuevos.

Se liberan las grillas del Worker al disponer el terreno y las instancias Three.js al disponer el LOD. Cada petición tiene un identificador independiente para evitar perder respuestas al actualizar luz/exageración concurrentemente.

La comparación reproducible sobre Orcadas 8 m está en terrain-comparison.json. En la primera cámara elimina 2496 triángulos colapsados y reduce los triángulos del LOD de 42632 a 40136; los buffers de plantillas e instancias pasan de 85392 a 82440 bytes. Los archivos DEM actuales (26 niveles) no contienen NoData explícito: el reparador es una protección, no evidencia de que los defectos visuales previos fueran NoData.

Pruebas: scripts/check-heightfield-lod.mjs y scripts/check-heightfield-repair.mjs. La comparación anterior usa la copia de referencia scripts/fixtures/lod-before.ts tomada antes de esta modificación. No se midieron FPS ni tiempo GPU. Sigue pendiente separar los archivos monolíticos para streaming de red por chunk; el descarte actual limita dibujo, no descarga. No se afirma una mejora visual de todas las costas basándose únicamente en estos tests.
