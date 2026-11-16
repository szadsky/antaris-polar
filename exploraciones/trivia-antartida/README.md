# Rumbo a la Antártida (trivia)

Trivia de 5 niveles, con 3 preguntas cada uno, que recorre el viaje de Ushuaia a la Antártida: canal Beagle, paso de
Drake, península, base científica y Tratado Antártico. Cada nivel superado asegura un premio. Después de cada
respuesta se muestra una explicación breve.

Es una página estática, sin compilación ni dependencias locales:

- `index.html`: portada con el botón «JUGAR».
- `trivia.html`: el juego. Las preguntas, los premios y las paradas del recorrido están en el arreglo `niveles` del
  script, al principio del archivo.
- `img/`: ilustraciones de las paradas, el barco, el pingüino y los fondos.
- `build/`: Bootstrap 3.3.7 y toastr, copiados tal cual.

## Cómo correrla

Abrir `index.html` en el navegador, o servir la carpeta con cualquier servidor estático. En este repo hay una
configuración `trivia-antartida` en `.claude/launch.json` (http://127.0.0.1:3430). Necesita conexión para cargar
jQuery y la tipografía Francois One.

## Pendiente antes de publicarla

- **Verificar cada respuesta con fuentes oficiales**, como pide el propio código. Algunas cifras son aproximadas y
  conviene citarlas con su fuente: el porcentaje de cruceros que zarpan de Ushuaia, la distancia y la duración del
  cruce del Drake, y el «90 % del hielo del mundo».
- **Origen de las imágenes de `img/`:** según los comentarios del código, son generadas. Falta documentar con qué
  herramienta se hicieron y marcarlas como ilustraciones, no fotografías.
- **Premios:** están escritos en `niveles` (postal, cupón del Tren del Fin del Mundo, pasaje por el canal Beagle).
  Hay que confirmar que existen antes de mostrarlos.

## Licencias de terceros

| Recurso | Licencia |
| --- | --- |
| Bootstrap 3.3.7 (`build/bootstrap.min.css`) | MIT |
| toastr (`build/toastr.min.js`, `.css`) | MIT |
| jQuery 3.3.1 (CDN de Google) | MIT |
| Francois One (Google Fonts) | SIL OFL 1.1 |
