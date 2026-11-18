/** Editorial content for the native-scroll journey. */
export const JOURNEY = [
 { place: '01 · Ushuaia', title: 'Tres días hasta bahía Margarita', text: 'En marzo de 2026, el rompehielos Almirante Irízar salió de la bahía de Ushuaia, cruzó el Pasaje Drake y llegó tres días después a bahía Margarita, donde está la Base San Martín. Los tres días corresponden a esa travesía.', link: 'Leer sobre la travesía · Armada Argentina', url: 'https://www.argentina.gob.ar/node/495002' },
 { place: '02 · Pasaje Drake', title: 'El barco va al sur. La corriente, al este.', text: 'La Corriente Circumpolar Antártica atraviesa el Drake de oeste a este. A partir de mediciones tomadas entre 2007 y 2011, un equipo estimó que por el pasaje fluyen, en promedio, 173 millones de metros cúbicos de agua por segundo.', link: 'Leer cómo se midió la corriente · CONICET', url: 'https://www.conicet.gov.ar/web-accesible/?nota_id=52052' },
 { place: '03 · Antártida', title: 'El hielo guarda aire del pasado', text: 'Cuando la nieve se compacta y se convierte en hielo, quedan atrapadas pequeñas burbujas de aire. Al analizarlas, los científicos pueden saber cuánto dióxido de carbono había en la atmósfera en otras épocas.', link: 'Leer qué revelan las burbujas del hielo · British Antarctic Survey (en inglés)', url: 'https://www.bas.ac.uk/news/antarctic-ice-explains-dip-in-co2-levels/' },
];
export function mountJourney() {
 const host=document.getElementById('contenido'); if(!host)return;
 JOURNEY.forEach((item,i)=>{
  const article=document.createElement('article');article.className='journey-stop';article.setAttribute('aria-labelledby','journey-title-'+i);
  const title=document.createElement('h2');title.id='journey-title-'+i;title.textContent=item.title;
  const text=document.createElement('p');text.className='journey-text';text.textContent=item.text;
  const link=document.createElement('a');link.textContent=item.link;link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';
  article.append(title,text,link);host.append(article);
  const connector=document.createElement('div');connector.className='journey-connector';connector.setAttribute('aria-hidden','true');
  // Alternating webbed footprints follow a gentle waddling path.
  const steps = [
   {x:66,y:16,angle:-18}, {x:94,y:40,angle:15},
   {x:78,y:65,angle:-10}, {x:106,y:90,angle:20},
   {x:76,y:115,angle:12}, {x:90,y:140,angle:30},
   {x:61,y:164,angle:5},
  ];
  const footprint = 'M0 8 C-3 8 -4 4 -4 1 L-9 -5 Q-10 -8 -7 -7 L-3 -4 L-2 -11 Q0 -14 2 -11 L3 -4 L7 -7 Q10 -8 9 -5 L4 1 C4 4 3 8 0 8 Z';
  const filterId='snow-print-'+i;
  connector.innerHTML='<svg viewBox="0 0 160 180" fill="currentColor"><defs><filter id="'+filterId+'" x="-50%" y="-50%" width="200%" height="200%"><feOffset in="SourceAlpha" dx="0" dy="1.5" result="offset"/><feGaussianBlur in="offset" stdDeviation="1.1" result="blur"/><feComposite in="SourceAlpha" in2="blur" operator="out" result="edge"/><feFlood flood-color="#536c82" flood-opacity=".65"/><feComposite in2="edge" operator="in" result="shadow"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shadow"/></feMerge></filter></defs><g filter="url(#'+filterId+')">'+steps.map(({x,y,angle})=>
   '<path d="'+footprint+'" transform="translate('+x+' '+y+') rotate('+(180+angle)+')"/>'
  ).join('')+'</g></svg>';host.append(connector);
 });
}
