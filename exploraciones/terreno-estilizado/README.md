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
