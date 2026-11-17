// Genera la máscara del frame de las islas (src/style.css, .islas-marco iframe). Correr desde exploraciones/hero:
//   node scripts/mascara-islas.cjs
const fs = require('fs');
let s = fs.readFileSync('src/style.css', 'utf8');
const a = s.indexOf('  /* Máscara sobre el propio frame (no una capa encima)');
// Reemplaza el bloque de la máscara (versión vieja con mask-composite o esta misma, si se vuelve a correr).
let cierre = '  mask-composite: intersect; }', b = s.indexOf(cierre, a);
if (b < 0) { cierre = 'mask-repeat: no-repeat; }'; b = s.indexOf(cierre, a); }
if (a < 0 || b < a) throw new Error('mascara');
const end = b + cierre.length;

// SVG de la máscara: óvalo × fundido vertical, con grano sumado al alfa (tramado del degradado).
const stops = (list) => list.map(([o, op]) => `<stop offset='${o}' stop-color='white' stop-opacity='${op}'/>`).join('');
const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' preserveAspectRatio='none'>`
  + `<defs>`
  + `<radialGradient id='o' cx='.5' cy='.56' r='.62' gradientTransform='translate(.5 .56) scale(1 1.03) translate(-.5 -.56)'>`
  + stops([['.58', 1], ['.68', .85], ['.79', .55], ['.9', .22], ['1', 0]]) + `</radialGradient>`
  + `<linearGradient id='v' x1='0' y1='0' x2='0' y2='1'>`
  + stops([['0', 0], ['.05', .05], ['.11', .18], ['.18', .4], ['.25', .66], ['.31', .86], ['.37', 1], ['.76', 1], ['.83', .8], ['.9', .45], ['.96', .14], ['1', 0]])
  + `</linearGradient>`
  + `<mask id='m' maskUnits='userSpaceOnUse' x='0' y='0' width='1000' height='1000'><rect width='1000' height='1000' fill='url(#v)'/></mask>`
  // Grano: ruido fino a alfa (media .04), sumado al alfa del degradado y centrado con −.04 → ±4 %.
  + `<filter id='g' x='0' y='0' width='1000' height='1000' filterUnits='userSpaceOnUse' color-interpolation-filters='sRGB'>`
  + `<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='1' seed='7' result='n'/>`
  + `<feColorMatrix in='n' type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .08 0 0 0 0' result='na'/>`
  + `<feComposite in='SourceGraphic' in2='na' operator='arithmetic' k1='0' k2='1' k3='1' k4='-.04'/>`
  + `</filter></defs>`
  + `<g filter='url(#g)'><rect width='1000' height='1000' fill='url(#o)' mask='url(#m)'/></g></svg>`;
const uri = 'data:image/svg+xml,' + svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'");

const nuevo = `  /* Máscara sobre el propio frame (no una capa encima): la escena se vuelve transparente hacia afuera y deja ver el
     fondo real de la página. Es un SVG: un óvalo suave (sin esquinas ni lados rectos) por un fundido vertical más ancho
     arriba (37 % del alto) que abajo (24 %), con grano fino sumado al alfa (feTurbulence, ±4 %) que trama los escalones
     del degradado. Generado por exploraciones/hero/scripts/mascara-islas.cjs. */
  -webkit-mask-image: url("${uri}");
  -webkit-mask-size: 100% 100%; -webkit-mask-repeat: no-repeat;
  mask-image: url("${uri}");
  mask-size: 100% 100%; mask-repeat: no-repeat; }`;
s = s.slice(0, a) + nuevo + s.slice(end);
fs.writeFileSync('src/style.css', s);
console.log('ok', uri.length);
