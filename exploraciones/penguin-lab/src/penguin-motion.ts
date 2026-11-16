// Authored foot travel measured from penguin.glb at the lab height of 1.25 m.
export const GAIT_SPEED = {walk:.346,run:.84};
/** m/s. Caminar y correr van ~2,4 veces más rápido que el paso grabado: la animación se acelera igual
 * (pies apoyados sin patinar). `slide` es la velocidad base del deslizamiento en plano. */
export const MOVE_SPEED = {walk:.85,run:1.9,slide:2.8};
/** Deslizamiento con pendiente: aceleración por gravedad efectiva sobre nieve y hielo (m/s² por unidad de
 * pendiente), rozamiento (m/s²) y velocidad máxima (m/s). En plano vuelve a la base; nunca baja de ella. */
export const SLIDE = {gravity:6,friction:.6,max:8};
/** Hielo: de pie, el pingüino patina con inercia (no se tira de panza; eso solo con E). `push`: impulso con
 * las teclas (m/s²) hasta la velocidad máxima en plano: caminando `walkMax`, con Shift `runMax`, de panza
 * (E) `bellyMax`. `friction`: rozamiento de pie (al soltar planea ~1,5 m y frena), `bellyFriction` de panza.
 * `turn`: giro máximo (rad/s, poca tracción). La pendiente acelera igual que en `SLIDE`, con el mismo tope. */
export const ICE = {push:4,walkMax:2.2,runMax:3.2,bellyMax:4.5,friction:1.6,bellyFriction:.8,turn:4};
/** Rozamiento (m/s²) de la nieve al salir del hielo con velocidad: sigue patinando y frena en ~1 s. */
export const SNOW_GLIDE = 3;
/** Desvíos (rad) probados al chocar con un obstáculo: el pingüino bordea costas y laderas en vez de frenar en seco. */
const DETOURS = [.4,.8,1.2];
/** Paso máximo de integración (m): a velocidad alta el movimiento se divide, así no saltea obstáculos finos. */
const MAX_SUBSTEP = .12;
/** Local character motion, in metres and seconds; independent of rendering and the DEM.
 * `canStand(x, z)` (optional) rejects positions such as water or slopes that are too steep.
 * `gradient(x, z)` (optional) returns the terrain slope [dh/dx, dh/dz]: the slide accelerates downhill.
 * `ice(x, z)` (optional, 0–1): on ice the penguin skates upright with momentum (see ICE); E: on its belly.
 * `fall` (optional): with the ground height and where it may land, the penguin can go DOWN slopes too steep to walk and
 * drop off edges (it falls with gravity and lands lower) instead of getting stuck on top of what it climbed. */
export class PenguinMotion {
 x=0;z=0;y=0;verticalSpeed=0;yaw=0;moving=false;running=false;sliding=false;
 /** Velocidad actual del deslizamiento o del patinaje (m/s). */
 slideSpeed=MOVE_SPEED.slide;
 /** Sobre hielo. */
 onIce=false;
 /** Siguiendo el impulso sobre la nieve después de salir del hielo. */
 carrying=false;
 /** Patinando de pie (hielo, o la frenada sobre nieve al salir) y si las teclas lo están impulsando. */
 skating=false;pushing=false;
 private groundSpeed=0;
 homeX=0;homeZ=0;homeYaw=0;
 /** Caer: altura del suelo (m) y si se puede caer ahí (tierra firme, no agua ni estructuras; la pendiente no importa). */
 fall?:{height:(x:number,z:number)=>number;canLand:(x:number,z:number)=>boolean};
 constructor(public limit:number,public canStand?:(x:number,z:number)=>boolean,public gradient?:(x:number,z:number)=>[number,number],public ice?:(x:number,z:number)=>number){}
 /** Point used by reset(): the island spawn, or the origin by default. */
 setHome(x:number,z:number,yaw=0){this.homeX=x;this.homeZ=z;this.homeYaw=yaw;this.reset();}
 reset(){this.x=this.homeX;this.z=this.homeZ;this.yaw=this.homeYaw;this.y=this.verticalSpeed=0;this.moving=this.running=this.sliding=this.onIce=this.carrying=this.skating=this.pushing=false;this.slideSpeed=MOVE_SPEED.slide;this.groundSpeed=0;}
 jump(){if(this.y===0&&this.verticalSpeed===0)this.verticalSpeed=2.7;}
 step(dx:number,dz:number,run:boolean,dt:number,slide=false){
  dt=Math.max(0,Math.min(dt,.05));
  const grounded=this.y===0&&this.verticalSpeed===0;
  if(grounded&&this.ice&&this.ice(this.x,this.z)>.5){this.iceStep(dx,dz,dt,run,slide,true);return;}
  // Saliendo del hielo: con E sigue de panza con la velocidad que traía; sin E sigue patinando de pie
  // sobre la nieve, que frena más (SNOW_GLIDE), hasta la velocidad de caminar: no se detiene en seco.
  if(this.onIce){this.onIce=false;this.carrying=!slide&&this.slideSpeed>MOVE_SPEED.walk+.3;if(slide)this.slideSpeed=Math.max(MOVE_SPEED.slide,this.slideSpeed);}
  if(this.carrying&&grounded&&!slide){
   if(this.slideSpeed>MOVE_SPEED.walk){this.iceStep(dx,dz,dt,run,false,false);return;}
   this.carrying=false;this.slideSpeed=MOVE_SPEED.slide;
  }
  this.carrying=false;this.skating=false;this.pushing=false;
  this.sliding=slide&&grounded;if(this.sliding&&Math.hypot(dx,dz)===0){dx=Math.sin(this.yaw);dz=Math.cos(this.yaw);}const length=Math.hypot(dx,dz);
  if(length>0){dx/=length;dz/=length;}
  if(this.sliding&&length>0){
   // Pendiente en la dirección del deslizamiento (negativa en bajada): acelera bajando, frena subiendo y en plano.
   const [gx,gz]=this.gradient?this.gradient(this.x,this.z):[0,0],along=gx*dx+gz*dz;
   this.slideSpeed=Math.min(SLIDE.max,Math.max(MOVE_SPEED.slide,this.slideSpeed+(-SLIDE.gravity*along-SLIDE.friction)*dt));
  }else this.slideSpeed=MOVE_SPEED.slide;
  const speed=this.sliding?this.slideSpeed:run?MOVE_SPEED.run:MOVE_SPEED.walk;
  const px=this.x,pz=this.z;
  if(length>0){
   this.yaw=Math.atan2(dx,dz);
   const travel=speed*dt,steps=Math.max(1,Math.ceil(travel/MAX_SUBSTEP)),each=travel/steps;
   for(let i=0;i<steps;i++){
    const sx=this.x,sz=this.z;this.x+=dx*each;this.z+=dz*each;
    const distance=Math.hypot(this.x,this.z);if(distance>this.limit){this.x*=this.limit/distance;this.z*=this.limit/distance;}
    if(this.fallMove(sx,sz,each,dx,dz))continue;
    if(this.canStand&&(this.x!==sx||this.z!==sz)&&!this.canStand(this.x,this.z)){
     this.detour(sx,sz,dx,dz,each);
     // Choque de frente mientras desliza: pierde el impulso.
     if(this.x===sx&&this.z===sz){this.slideSpeed=MOVE_SPEED.slide;break;}
    }
   }
  }
  this.moving=Math.hypot(this.x-px,this.z-pz)>1e-6;this.running=this.moving&&run&&!this.sliding;
  this.groundSpeed=dt>0?Math.hypot(this.x-px,this.z-pz)/dt:0;
  if(this.y>0||this.verticalSpeed>0){this.y+=this.verticalSpeed*dt-5*dt*dt;this.verticalSpeed-=10*dt;if(this.y<=0){this.y=0;this.verticalSpeed=0;}}
 }
 /** Hielo: patina de pie con inercia (de panza si `belly`, con E). El rumbo gira de a poco hacia las teclas;
  * las teclas impulsan, la pendiente acelera o frena y el rozamiento es muy bajo: al soltar sigue planeando.
  * Con `ice` falso es la frenada sobre la nieve al salir del hielo (sin impulso, más rozamiento). */
 private iceStep(dx:number,dz:number,dt:number,run:boolean,belly:boolean,ice:boolean){
  // Al entrar al hielo arranca con la velocidad que traía (caminando, corriendo o deslizando).
  if(ice&&!this.onIce){this.onIce=true;this.carrying=false;this.slideSpeed=this.groundSpeed;}
  const input=Math.hypot(dx,dz)>0;
  this.sliding=belly;this.skating=!belly;this.pushing=input&&ice;this.running=!belly&&input&&run;
  const pushAcc=ice?ICE.push:0,friction=ice?(belly?ICE.bellyFriction:ICE.friction):SNOW_GLIDE;
  const pushMax=belly?ICE.bellyMax:run?ICE.runMax:ICE.walkMax;
  if(input){
   const target=Math.atan2(dx,dz);let turn=Math.atan2(Math.sin(target-this.yaw),Math.cos(target-this.yaw));
   const max=ICE.turn*dt;turn=Math.max(-max,Math.min(max,turn));this.yaw+=turn;
  }
  const hx=Math.sin(this.yaw),hz=Math.cos(this.yaw);
  const [gx,gz]=this.gradient?this.gradient(this.x,this.z):[0,0],along=gx*hx+gz*hz;
  // Impulso solo hasta pushMax y si el rumbo ya apunta más o menos hacia donde se pide.
  const push=input&&this.slideSpeed<pushMax?pushAcc:0;
  this.slideSpeed=Math.min(SLIDE.max,Math.max(0,this.slideSpeed+(push-SLIDE.gravity*along-friction)*dt));
  const px=this.x,pz=this.z,travel=this.slideSpeed*dt,steps=Math.max(1,Math.ceil(travel/MAX_SUBSTEP)),each=travel/steps;
  for(let i=0;i<steps&&travel>0;i++){
   const sx=this.x,sz=this.z;this.x+=hx*each;this.z+=hz*each;
   const distance=Math.hypot(this.x,this.z);if(distance>this.limit){this.x*=this.limit/distance;this.z*=this.limit/distance;}
   if(this.fallMove(sx,sz,each,hx,hz))continue;
   if(this.canStand&&!this.canStand(this.x,this.z)){
    this.detour(sx,sz,hx,hz,each);
    if(this.x===sx&&this.z===sz){this.slideSpeed=0;break;} // choque de frente: se frena
    // Rozando un borde: el rumbo sigue al desvío.
    this.yaw=Math.atan2(this.x-sx,this.z-sz);
   }
  }
  this.moving=Math.hypot(this.x-px,this.z-pz)>1e-6;
  this.groundSpeed=dt>0?Math.hypot(this.x-px,this.z-pz)/dt:0;
 }
 /**
  * Caída (con `fall`): en el aire conserva su altura absoluta (y = altura sobre el suelo nuevo) y aterriza donde el suelo
  * lo alcanza; en el suelo, un paso hacia ABAJO por una ladera demasiado empinada para caminar se permite, y si baja más
  * de ~0,9 m por metro (un borde, ~42°) se despega y cae con la gravedad. Devuelve true si el paso queda aceptado.
  */
 private fallMove(sx:number,sz:number,step:number,dx:number,dz:number){
  const f=this.fall;if(!f||(this.x===sx&&this.z===sz))return false;
  const h0=f.height(sx,sz),h1=f.height(this.x,this.z);
  if(this.y>0||this.verticalSpeed>0){
   const y=this.y+h0-h1;
   if(y>=0&&f.canLand(this.x,this.z)){this.y=y;return true;}
   // el suelo nuevo está por encima de los pies: aterriza ahí si se puede pisar; si no, choca
   if(y<0&&(!this.canStand||this.canStand(this.x,this.z))){this.y=0;this.verticalSpeed=0;return true;}
   return false;
  }
  if(this.canStand&&this.canStand(this.x,this.z))return false; // paso normal
  // solo hacia abajo (también en el borde de arriba, donde el suelo todavía no bajó: se mira 15 cm más adelante) y a tierra firme
  const ahead=f.height(this.x+dx*.15,this.z+dz*.15);
  if((h1>=h0-.005&&ahead>=h0-.03)||!f.canLand(this.x,this.z))return false;
  if(h0-h1>step*.9){this.y=h0-h1;this.verticalSpeed=0;}          // borde: se despega y cae
  return true;
 }
 /** Blocked: slide along the obstacle (projected step, cos of the detour) unless it is head-on. */
 private detour(px:number,pz:number,dx:number,dz:number,step:number){
  this.x=px;this.z=pz;
  for(const angle of DETOURS){
   const options=[angle,-angle].map(a=>{const c=Math.cos(a),s=Math.sin(a),d=step*c;return {x:px+(dx*c+dz*s)*d,z:pz+(-dx*s+dz*c)*d};}).filter(p=>this.canStand!(p.x,p.z));
   if(options.length===1){this.x=options[0].x;this.z=options[0].z;return;}
   if(options.length===2){
    // Los dos desvíos inmediatos libres: en un choque rasante contra una pared también pasa. Se mira
    // 35 cm más adelante de qué lado está la pared y se sigue por el otro; empate = de frente: frena.
    const free=(side:number)=>[.2,.4,.6].filter(a=>{const c=Math.cos(a*side),s=Math.sin(a*side);return this.canStand!(px+(dx*c+dz*s)*.35,pz+(-dx*s+dz*c)*.35);}).length;
    const plus=free(1),minus=free(-1);
    if(plus!==minus){const p=options[plus>minus?0:1];this.x=p.x;this.z=p.z;}
    return;
   }
  }
 }
}
