import { setupTouchControls } from '../../penguin-lab/src/touch-controls';
/**
 * Última sección del home: el pingüino en las islas de práctica (exploraciones/penguin-lab, /pinguino-menu/?embed).
 *
 * Por qué un iframe: la escena de las islas es otra página con su propio Three.js, modelo, texturas y bucle. Incrustada,
 * no comparte nada con el hero (ni memoria de GPU ni código) y la ruta sigue siendo la misma que se publica sola.
 *
 * - Carga diferida: el iframe recién se crea cuando la sección está a menos de ~1 pantalla (IntersectionObserver). Hasta
 *   ahí el home no descarga ni un byte de las islas. Con «reducir movimiento», se carga solo con el botón.
 * - Pausa: cuando la sección sale de vista, se le pide a las islas que dejen de dibujar (postMessage, mismo origen) y
 *   se reanudan al volver. Así el hero y las islas no dibujan a la vez.
 * - Captura del mouse: sin activar, una capa encima deja pasar la rueda al scroll de la página (si no, la rueda haría
 *   zoom en la escena y el home quedaría trabado). Un clic en «Explorar el terreno» la activa; se desactiva al sacar el
 *   puntero o al salir de vista.
 */
const ORIGEN: string = import.meta.env.VITE_SITIO ?? (import.meta.env.DEV ? 'http://127.0.0.1:3410' : '');
const RUTA = '/pinguino-menu/';

export function mountIslas() {
  const seccion = document.getElementById('islas');
  const marco = seccion?.querySelector<HTMLElement>('.islas-marco');
  const estado = seccion?.querySelector<HTMLElement>('.islas-estado');
  const activar = seccion?.querySelector<HTMLButtonElement>('.islas-activar');
  const completa = seccion?.querySelector<HTMLAnchorElement>('.islas-completa');
  if (!seccion || !marco || !estado || !activar) return;
  if (completa) completa.href = ORIGEN + RUTA;
  const help=seccion.querySelector<HTMLElement>('.islas-ayuda');
  if(help){help.tabIndex=0;help.setAttribute('aria-label','Controles del explorador');marco.append(help);}

  let iframe: HTMLIFrameElement | null = null;
  let visible = false;
  const mobile=matchMedia('(pointer: coarse)').matches;
  const origin=ORIGEN?new URL(ORIGEN).origin:location.origin;
  const destinations:Record<string,{label:string;url:string}>={base:{label:'Bases',url:'/descubrir/'},comunicaciones:{label:'Investigaciones',url:'/investigaciones/'},antena:{label:'Noticias',url:'/noticias/'},oruga:{label:'AntarisPlay',url:'/antarisplay/'}};
  const labels=new Map<string,HTMLAnchorElement>();
  for(const [id,d] of Object.entries(destinations)){const a=document.createElement('a');a.className='islas-station';a.textContent=d.label;a.href=ORIGEN+d.url;a.hidden=true;marco.append(a);labels.set(id,a);for(const event of ['pointerenter','focus'])a.addEventListener(event,()=>iframe?.contentWindow?.postMessage({type:'antaris:label-hover',id},origin));for(const event of ['pointerleave','blur'])a.addEventListener(event,()=>iframe?.contentWindow?.postMessage({type:'antaris:label-hover',id:null},origin));}
  window.addEventListener('message',e=>{if(e.origin!==origin||e.source!==iframe?.contentWindow)return;
   if(e.data?.type==='antaris:stations'&&Array.isArray(e.data.positions))for(const p of e.data.positions){const a=labels.get(p.id);if(!a||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;const x=p.x*marco.clientWidth,y=p.y*marco.clientHeight;const half=(a.offsetWidth||140)/2;const height=a.offsetHeight||40;a.hidden=!p.shown||x<half+12||x>marco.clientWidth-half-12||y<height+16||y>marco.clientHeight-24;a.style.left='0';a.style.top='0';a.style.transform='translate3d('+x+'px,'+y+'px,0) translate(-50%,-100%)';}
   if(e.data?.type==='antaris:hover'){for(const [id,a] of labels)a.classList.toggle('is-hovered',id===e.data.id);marco.style.cursor=e.data.id?'pointer':'';}
   if(e.data?.type==='antaris:nearby'){const d=destinations[e.data.id];nearby.hidden=!d||!expanded;nearby.textContent=d?'Explorar '+d.label:'';nearby.dataset.station=d?e.data.id:'';}
   if(e.data?.type==='antaris:navigate'){const d=destinations[e.data.id];if(d)location.assign(ORIGEN+d.url);}
  });
  const close=document.createElement('button');close.type='button';close.className='islas-cerrar';close.textContent='Volver al recorrido';close.hidden=true;marco.append(close);
  let expanded=false;
  const mobilePanel=document.createElement('div');mobilePanel.className='islas-mobile-controls';mobilePanel.hidden=true;marco.after(mobilePanel);
  const nearby=document.createElement('button');nearby.type='button';nearby.className='islas-nearby';nearby.hidden=true;mobilePanel.append(nearby);
  nearby.addEventListener('click',()=>{const d=destinations[nearby.dataset.station??''];if(d)location.assign(ORIGEN+d.url);});
  const touch=mobile?setupTouchControls({onJump:()=>iframe?.contentWindow?.postMessage({type:'antaris:touch-jump'},origin),onFirstTouch:()=>iframe?.contentWindow?.postMessage({type:'antaris:touch-unlock'},origin)}):null;
  if(touch){const root=document.body.lastElementChild;if(root?.classList.contains('touch-controls'))mobilePanel.append(root);}
  let inputTimer:ReturnType<typeof setInterval>|undefined;
  const sendInput=()=>iframe?.contentWindow?.postMessage({type:'antaris:touch-input',input:touch?.input,active:expanded&&mobile},origin);

  const closeExplorer=()=>{
    if(!expanded)return;
    expanded=false;mobilePanel.hidden=true;nearby.hidden=true;touch?.release();clearInterval(inputTimer);sendInput();document.documentElement.classList.remove('explorando-islas');marco.classList.remove('expandida');close.hidden=true;setActiva(false);activar.focus({preventScroll:true});
  };
  close.addEventListener('click',closeExplorer);
  window.addEventListener('keydown',e=>{if(e.key==='Escape')closeExplorer();});
  window.addEventListener('message',e=>{if(e.source===iframe?.contentWindow&&e.origin===origin&&e.data==='antaris:close')closeExplorer();});
  const openExplorer=()=>{
    expanded=true;mobilePanel.hidden=!mobile;if(mobile){sendInput();clearInterval(inputTimer);inputTimer=setInterval(sendInput,33);}document.documentElement.classList.add('explorando-islas');marco.classList.add('expandida');close.hidden=false;
    setActiva(true);avisar('antaris:sigue');
    marco.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  };
  const avisar = (msg: 'antaris:pausa' | 'antaris:sigue') => {
    // Mismo origen en el sitio armado; en desarrollo (otro puerto) no hace falta: el navegador ya frena los iframes de
    // otro origen fuera de pantalla.
    try { iframe?.contentWindow?.postMessage(msg, ORIGEN ? new URL(ORIGEN).origin : location.origin); } catch { /* sin acceso */ }
  };
  const setActiva = (on: boolean) => {
    marco.classList.toggle('activa', on);
    activar.hidden = on || !iframe;
    if (on) iframe?.focus();
  };
  const cargar = () => {
    if (iframe) return;
    iframe = document.createElement('iframe');
    iframe.title = 'Islas de práctica: el pingüino en un terreno 3D (relieve sintético)';
    iframe.src = ORIGEN + RUTA + '?embed&parentOrigin='+encodeURIComponent(location.origin);
    iframe.allow = 'fullscreen';
    iframe.addEventListener('load', () => {
      marco.dataset.state = 'listo';
      estado.textContent = '';
      if(expanded){setActiva(true);sendInput();}
      if (!visible && !expanded) avisar('antaris:pausa');
    });
    marco.dataset.state = 'cargando';
    estado.textContent = 'Cargando las islas…';
    marco.prepend(iframe);
    activar.hidden = false;
  };

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    activar.hidden = false;
    activar.textContent = 'Cargar las islas';
    estado.textContent = 'La escena se mueve: se carga solo si la pedís.';
  }
  activar.addEventListener('click', () => { if (!iframe) { cargar(); activar.textContent = 'Explorar el terreno'; } openExplorer(); });
  marco.addEventListener('pointerleave', () => {if(!expanded)setActiva(false);iframe?.contentWindow?.postMessage({type:'antaris:label-hover',id:null},origin);});
  const pick=(e:PointerEvent|MouseEvent,click=false)=>{const r=marco.getBoundingClientRect();iframe?.contentWindow?.postMessage({type:'antaris:pick',x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height,click},origin);};
  marco.addEventListener('pointermove',e=>{if(e.target===marco&&!marco.classList.contains('activa'))pick(e);});
  // Un clic en cualquier parte de la escena (la capa ::before) también la activa.
  marco.addEventListener('click', (e) => { if (iframe && e.target === marco) {pick(e,true);setActiva(true);} });

  // Cerca (≈ 1 pantalla antes): crear el iframe. En vista: dibujar; fuera: pausar.
  if (!reduce) {
    new IntersectionObserver(([e]) => { if (e.isIntersecting) cargar(); }, { rootMargin: '100% 0px' }).observe(seccion);
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    document.documentElement.classList.toggle('explorando-islas',expanded&&visible);
    avisar(visible ? 'antaris:sigue' : 'antaris:pausa');
    if (!visible){touch?.release();setActiva(false);}
  }).observe(marco);
}
