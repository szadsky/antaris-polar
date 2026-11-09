# Exploración · terreno más nítido sin pesar más

> **Prueba aislada, no es el sitio.** Pregunta: ¿se puede ver el terreno REMA bastante más nítido **sin aumentar la descarga** respecto de [`terreno-bases`](../terreno-bases/)?

Respuesta corta: **sí**. Mismo peso de descarga, el doble de resolución para la luz (4 m en vez de 8 m) y todo el sombreado calculado por píxel. Tiene un botón **Antes / Después** (tecla `A`) para compararlo con el mismo dato y la misma cámara.

## Correrlo

```bash
npm install
npm run dev      # http://localhost:3300/?base=carlini   (?nivel=8m simula el celular · ?modo=antes)
```

Los terrenos ya procesados están en `public/terreno/`. Para regenerarlos desde `data/rema` (ver `pipeline/rema`): `npm run convert`.

## Cómo funciona

1. **Precisión acorde al dato, más resolución.** Las alturas se guardaban con pasos de 1,7 cm, muy por debajo de lo que REMA puede asegurar. Con pasos de 0,5 m, el archivo ocupa la mitad, y ese espacio paga una grilla de 4 m en vez de 8 m.
2. **Des-cuantización restringida (en el worker).** Cada altura guardada solo dice "el valor real está en ±25 cm". Se reconstruye la superficie más suave que respeta esos intervalos: en zonas planas desaparece el aterrazado de los escalones de 0,5 m; en pendientes el detalle queda intacto. No se sale nunca del rango que el dato permite.
3. **Textura de superficie (en el worker, 0 bytes de descarga).** A resolución completa: normal del terreno (luz), sombreado de cavidades a 3 escalas (≈ 8, 24 y 64 m) y clase mar/tierra (costa SCAR ADD).
4. **Malla liviana.** La geometría usa una muestra de cada 2 (8 m en computadora, 16 m en celular), igual que antes: la GPU dibuja la misma cantidad de triángulos.
5. **Shader.** Luz y color se calculan por píxel desde esa textura.

## Resultados medidos (misma PC con GPU integrada AMD Radeon, navegador del panel)

| | terreno-bases | terreno-nitidez |
|---|---|---|
| Descarga computadora | 8 m · 222–865 KB | **4 m · 153–860 KB** |
| Descarga celular | 16 m · 67–244 KB | **8 m · 56–296 KB** |
| Triángulos (computadora) | 2 M | 2 M |
| Primera vista | 92–130 ms | 400–810 ms |
| Trabajo del worker (4 m) | ~220 ms | ~1,3–1,7 s, en segundo plano |
| Bloqueo máx. del hilo principal | 68–91 ms | 51–165 ms (subida de la textura a la GPU) |

Verificado a ojo en Carlini (rocas y bordes nítidos, microrelieve en la nieve) y Belgrano II: con paso 0,5 m sin reconstrucción aparecían franjas en el hielo plano; con la reconstrucción se ven igual que con paso 0,1 m (que pesa el doble).

## Pendiente

- **Medir en celular real.** El worker hace más trabajo que antes; en un equipo de gama media la primera vista puede tardar 2–3 s (estimado, sin medir). Si molesta: menos iteraciones de reconstrucción o cavidades a menor resolución en el nivel de 8 m.
- **Memoria de GPU.** La textura de 4 m es de 2000×2000 RGBA (~21 MB con mipmaps) además de la malla.
- **Estilo.** El color nieve/roca por pendiente es estético. Esta base (luz y color por píxel en el shader) es la que permitiría más adelante una reinterpretación estilizada, al estilo de los sitios de referencia del proyecto.

## Fuentes

Mismas que `terreno-bases`: REMA v2.0 (PGC, CC BY 4.0), costa SCAR ADD v7.12 (CC BY 4.0, confirmar para v7.12), ubicación de bases COMNAP nov 2024 (solo uso educativo y no comercial).
