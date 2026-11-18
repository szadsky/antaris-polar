/** Relative device tilt; permission is requested only from a direct tap. */
export function mountDeviceParallax(host:HTMLElement,move:(x:number,y:number)=>void,reduced:MediaQueryList){
 const Orientation=window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {requestPermission?:()=>Promise<string>};
 let enabled=false,received=false,baseline:{beta:number;gamma:number}|null=null,disposed=false;
 if(!matchMedia('(pointer: coarse)').matches||!window.isSecureContext||!Orientation)return {active:()=>false,dispose:()=>{}};
 const button=document.createElement('button');button.type='button';button.className='hero-motion';host.append(button);
 const sync=()=>{button.hidden=reduced.matches;button.textContent=enabled?'Desactivar movimiento':'Activar movimiento';button.setAttribute('aria-pressed',String(enabled));};
 const calibrate=()=>{baseline=null;received=false;move(0,0);};
 const sensor=(e:DeviceOrientationEvent)=>{
  if(!enabled||reduced.matches||document.hidden||e.beta===null||e.gamma===null)return;
  if(!Number.isFinite(e.beta)||!Number.isFinite(e.gamma))return;
  baseline??={beta:e.beta,gamma:e.gamma};received=true;
  const delta=(value:number,origin:number)=>((value-origin+540)%360)-180;
  const x=delta(e.gamma,baseline.gamma)/22,y=delta(e.beta,baseline.beta)/22;
  const angle=(screen.orientation?.angle??0)*Math.PI/180;
  const clamp=(v:number)=>Math.max(-1,Math.min(1,v));
  move(clamp(x*Math.cos(angle)+y*Math.sin(angle)),clamp(y*Math.cos(angle)-x*Math.sin(angle)));
 };
 const toggle=async()=>{
  if(enabled){enabled=false;calibrate();sync();return;}
  try{
   if(Orientation.requestPermission&&await Orientation.requestPermission()!=='granted'){button.textContent='Movimiento no habilitado';return;}
   if(disposed)return;enabled=true;calibrate();sync();
  }catch{button.textContent='Movimiento no disponible';}
 };
 const preference=()=>{if(reduced.matches){enabled=false;calibrate();}sync();};
 button.addEventListener('click',toggle);
 window.addEventListener('deviceorientation',sensor,{passive:true});
 window.addEventListener('orientationchange',calibrate);
 screen.orientation?.addEventListener('change',calibrate);
 document.addEventListener('visibilitychange',calibrate);
 reduced.addEventListener('change',preference);
 if(!Orientation.requestPermission&&!reduced.matches)enabled=true;
 sync();
 return {active:()=>enabled&&received,dispose:()=>{disposed=true;window.removeEventListener('deviceorientation',sensor);window.removeEventListener('orientationchange',calibrate);screen.orientation?.removeEventListener('change',calibrate);document.removeEventListener('visibilitychange',calibrate);reduced.removeEventListener('change',preference);button.remove();}};
}
