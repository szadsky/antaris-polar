// Genera la máscara del modelo 3D de Noticias e Investigaciones (src/secciones/mascara-modelo.css).
// Correr desde exploraciones/hero:  node scripts/mascara-modelo.cjs
//
// Elipse como el degradado del Figma (nodo 2574:402: radios ≈ 0,55 del ancho y 0,5 del alto, del centro nítido a los
// bordes del color de la página) con grano fino sumado al alfa (feTurbulence, ±4 %) que trama los escalones del
// degradado; igual que la máscara de las islas del home (scripts/mascara-islas.cjs).
const fs = require('fs');
const stops = (list) => list.map(([o, op]) => `<stop offset='${o}' stop-color='white' stop-opacity='${op}'/>`).join('');
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' preserveAspectRatio='none'>`
  + `<defs><radialGradient id='o' cx='.5' cy='.5' r='.5' gradientTransform='translate(.5 .5) scale(1.09 1) translate(-.5 -.5)'>`
  + stops([['0', 1], ['.5', 1], ['.62', .86], ['.74', .56], ['.86', .22], ['1', 0]]) + `</radialGradient>`
  + `<filter id='g' x='0' y='0' width='1000' height='1000' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'>`
  + `<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='1' seed='11' result='n'/>`
  + `<feColorMatrix in='n' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .08 0 0 0 0' result='na'/>`
  + `<feComposite in='SourceGraphic' in2='na' operator='arithmetic' k1='0' k2='1' k3='1' k4='-.04'/>`
  + `</filter></defs><g filter='url(#g)'><rect width='1000' height='1000' fill='url(#o)'/></g></svg>`;
const uri = 'data:image/svg+xml,' + svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E');
const css = `/* Generado por scripts/mascara-modelo.cjs: no editar a mano. Máscara del modelo 3D (elipse con grano). */
.sec-modelo canvas {
  -webkit-mask-image: url("${uri}"); -webkit-mask-size: 100% 100%; -webkit-mask-repeat: no-repeat;
  mask-image: url("${uri}"); mask-size: 100% 100%; mask-repeat: no-repeat;
}
`;
fs.writeFileSync('src/secciones/mascara-modelo.css', css);
console.log('ok', uri.length);
