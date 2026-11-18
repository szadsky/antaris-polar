import { FootstepAudio } from '../../penguin-lab/src/footstep-audio';
/** Editorial content for the native-scroll journey. */
export const JOURNEY = [
 { place: '01 · Ushuaia', title: '¿Cuánto se tarda en llegar a la Antártida?', text: 'En marzo de 2026, el rompehielos Almirante Irízar salió de la bahía de Ushuaia, cruzó el Pasaje Drake y llegó tres días después a bahía Margarita, donde está la Base San Martín. Los tres días corresponden a esa travesía.', link: 'Leer sobre la travesía · Armada Argentina', url: 'https://www.argentina.gob.ar/node/495002' },
 { place: '02 · Pasaje Drake', title: '¿Qué corriente atraviesa el Pasaje Drake?', text: 'La Corriente Circumpolar Antártica atraviesa el Drake de oeste a este. A partir de mediciones tomadas entre 2007 y 2011, un equipo estimó que por el pasaje fluyen, en promedio, 173 millones de metros cúbicos de agua por segundo.', link: 'Leer cómo se midió la corriente · CONICET', url: 'https://www.conicet.gov.ar/web-accesible/?nota_id=52052' },
 { place: '03 · Antártida', title: '¿Cómo sabemos qué aire se respiraba hace miles de años?', text: 'Cuando la nieve se compacta y se convierte en hielo, quedan atrapadas pequeñas burbujas de aire. Al analizarlas, los científicos pueden saber cuánto dióxido de carbono había en la atmósfera en otras épocas.', link: 'Leer qué revelan las burbujas del hielo · British Antarctic Survey (en inglés)', url: 'https://www.bas.ac.uk/news/antarctic-ice-explains-dip-in-co2-levels/' },
];
export function mountJourney() {
 const host=document.getElementById('contenido'); if(!host)return;
 const trails:{element:HTMLElement;prints:SVGPathElement[];positions:number[];amounts:number[];started:boolean[]}[]=[];
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
   '<path class="journey-footprint" d="'+footprint+'" transform="translate('+x+' '+y+') rotate('+(180+angle)+')"/>'
  ).join('')+'</g></svg>';host.append(connector);
  trails.push({element:connector,prints:[...connector.querySelectorAll<SVGPathElement>('.journey-footprint')],positions:steps.map(step=>step.y/180),amounts:steps.map(()=>0),started:steps.map(()=>false)});
 });
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const audio=new FootstepAudio('');
 let soundEnabled=false;
 const explore=host.ownerDocument.querySelector<HTMLAnchorElement>('.hero-explore');
 const enableSound=(event:MouseEvent)=>{
  if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();soundEnabled=true;audio.unlock();
  host.scrollIntoView({behavior:reduced.matches?'auto':'smooth',block:'start'});
 };
 explore?.addEventListener('click',enableSound);
 let frame=0,lastTime=performance.now(),nextStep=0;
 const update=(now=performance.now())=>{
  frame=0;
  const delta=Math.min(50,Math.max(0,now-lastTime));lastTime=now;
  const line=innerHeight*.80;
  let pending=false;
  for(const trail of trails){
   const rect=trail.element.getBoundingClientRect();
   trail.prints.forEach((print,i)=>{
    const y=rect.top+trail.positions[i]*rect.height;
    if(reduced.matches||y<0){trail.amounts[i]=1;trail.started[i]=true;}
    else if(y>line+32){trail.amounts[i]=0;trail.started[i]=false;}
    else if(y<=line){
     if(!trail.started[i]&&now>=nextStep&&!document.hidden){
      trail.started[i]=true;nextStep=now+350;
      if(soundEnabled)audio.play(false,false,i%2?1:-1);
     }
     if(trail.started[i])trail.amounts[i]=Math.min(1,trail.amounts[i]+delta/450);
     if(trail.amounts[i]<1)pending=true;
    }
    const amount=trail.amounts[i];
    print.style.opacity=String(amount*amount*(3-2*amount));
   });
  }
  if(pending&&!document.hidden)frame=requestAnimationFrame(update);
 };
 const schedule=()=>{if(!frame){lastTime=performance.now();frame=requestAnimationFrame(update);}};
 const visibility=()=>{if(document.hidden){audio.stop();cancelAnimationFrame(frame);frame=0;}else schedule();};
 window.addEventListener('scroll',schedule,{passive:true});
 window.addEventListener('resize',schedule);
 document.addEventListener('visibilitychange',visibility);
 reduced.addEventListener('change',schedule);
 const observer=new ResizeObserver(schedule);observer.observe(host);
 void document.fonts.ready.then(schedule);
 update();
 window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);audio.dispose();explore?.removeEventListener('click',enableSound);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',schedule);observer.disconnect();},{once:true});
}
