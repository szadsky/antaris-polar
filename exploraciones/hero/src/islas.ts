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
 *   zoom en la escena y el home quedaría trabado). Un clic en «Explorar las islas» la activa; se desactiva al sacar el
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

  let iframe: HTMLIFrameElement | null = null;
  let visible = false;
  const origin=ORIGEN?new URL(ORIGEN).origin:location.origin;
  const toolbar=document.createElement('div');toolbar.className='islas-toolbar';toolbar.setAttribute('aria-label','Controles de la isla');
  const sound=document.createElement('button');sound.type='button';sound.textContent='Sonido activado';sound.setAttribute('aria-pressed','true');
  const reset=document.createElement('button');reset.type='button';reset.textContent='Restablecer vista';
  toolbar.append(sound,reset);marco.before(toolbar);
  for(const [button,id] of [[sound,'step-sound'],[reset,'reset']] as const)button.addEventListener('click',()=>iframe?.contentWindow?.postMessage({type:'antaris:control',id},origin));
  const destinations:Record<string,{label:string;url:string}>={base:{label:'Bases',url:'/descubrir/'},comunicaciones:{label:'Investigaciones',url:'/investigaciones/'},antena:{label:'Noticias',url:'/noticias/'},oruga:{label:'AntarisPlay',url:'/antarisplay/'}};
  const labels=new Map<string,HTMLAnchorElement>();
  for(const [id,d] of Object.entries(destinations)){const a=document.createElement('a');a.className='islas-station';a.textContent=d.label;a.href=ORIGEN+d.url;a.hidden=true;marco.append(a);labels.set(id,a);}
  window.addEventListener('message',e=>{if(e.origin!==origin||e.source!==iframe?.contentWindow)return;
   if(e.data?.type==='antaris:stations'&&Array.isArray(e.data.positions))for(const p of e.data.positions){const a=labels.get(p.id);if(!a||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;const x=p.x*marco.clientWidth,y=p.y*marco.clientHeight;const half=(a.offsetWidth||140)/2;const height=a.offsetHeight||40;a.hidden=!p.shown||x<half+12||x>marco.clientWidth-half-12||y<height+16||y>marco.clientHeight-24;a.style.left='0';a.style.top='0';a.style.transform='translate3d('+x+'px,'+y+'px,0) translate(-50%,-100%)';}
   if(e.data?.type==='antaris:sound'){const on=e.data.text==='Sonido activado';sound.textContent=on?'Sonido activado':'Sonido desactivado';sound.setAttribute('aria-pressed',String(on));}
  });
  const actions=document.createElement('div');actions.className='islas-actions';marco.after(actions);actions.append(activar);
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
      if (!visible) avisar('antaris:pausa');
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
  activar.addEventListener('click', () => { if (!iframe) { cargar(); activar.textContent = 'Explorar las islas'; } setActiva(true); });
  marco.addEventListener('pointerleave', () => setActiva(false));
  // Un clic en cualquier parte de la escena (la capa ::before) también la activa.
  marco.addEventListener('click', (e) => { if (iframe && e.target === marco) setActiva(true); });

  // Cerca (≈ 1 pantalla antes): crear el iframe. En vista: dibujar; fuera: pausar.
  if (!reduce) {
    new IntersectionObserver(([e]) => { if (e.isIntersecting) cargar(); }, { rootMargin: '100% 0px' }).observe(seccion);
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    avisar(visible ? 'antaris:sigue' : 'antaris:pausa');
    if (!visible) setActiva(false);
  }).observe(marco);
}
