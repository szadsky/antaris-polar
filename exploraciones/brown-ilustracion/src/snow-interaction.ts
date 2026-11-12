import * as THREE from 'three';
import type {Terrain} from './terrain';
const N=256,SIZE=128;
const data=new Uint8Array(N*N),texture=new THREE.DataTexture(data,N,N,THREE.RedFormat);
texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.needsUpdate=true;
export const snowInteractionUniforms={uTracks:{value:texture},uTrackArea:{value:new THREE.Vector3(0,0,SIZE)},uTrackOn:{value:0}};
export const TRACK_PARS=`
uniform sampler2D uTracks; uniform vec3 uTrackArea; uniform float uTrackOn;
float trackDepth(vec2 p){vec2 uv=(p-uTrackArea.xy)/uTrackArea.z+.5;float inside=step(0.,uv.x)*step(uv.x,1.)*step(0.,uv.y)*step(uv.y,1.);return texture2D(uTracks,clamp(uv,0.,1.)).r*.22*inside*uTrackOn;}`;
export const TRACK_VERTEX=`transformed.y-=trackDepth((modelMatrix*vec4(transformed,1.)).xz);`;
export const TRACK_NORMAL=`if(uTrackOn>.5){float e=.5;vec2 p=vWorld.xz;vec2 grad=vec2(trackDepth(p+vec2(e,0.))-trackDepth(p-vec2(e,0.)),trackDepth(p+vec2(0.,e))-trackDepth(p-vec2(0.,e)))/(2.*e);nd=normalize(nd+vec3(grad.x,0.,grad.y)*(1.-rockT));}`;
export function mountSnowInteraction(canvas:HTMLCanvasElement,camera:THREE.PerspectiveCamera,getTerrain:()=>Terrain|null,refresh:()=>void,getScale:()=>number=()=>1){
 let enabled=true,anchored=false;let down:{x:number;y:number;id:number}|null=null;
 const panel=document.createElement('div');panel.style.cssText='position:fixed;bottom:20px;left:20px;z-index:20;display:flex;gap:8px';
 const button=document.createElement('button'),clear=document.createElement('button');button.textContent='Huellas: activadas';clear.textContent='Borrar huellas';
 for(const b of [button,clear])b.style.cssText='padding:10px 14px;border:1px solid #a5b8d1;border-radius:14px;background:#eee9dc;color:#35465f;cursor:pointer';
 const size=document.createElement('input'),label=document.createElement('label'),feedback=document.createElement('span');
 size.type='range';size.min='1';size.max='12';size.step='1';size.value='6';size.setAttribute('aria-label','Tamaño de huella en metros');
 label.style.cssText='background:#eee9dc;color:#35465f;padding:8px;border-radius:12px';label.append('Huella ampliada · ',size);
 feedback.style.cssText='background:#eee9dc;color:#35465f;padding:8px;border-radius:12px';feedback.textContent='Tocá para marcar · arrastrá para mover';feedback.setAttribute('role','status');
 panel.style.flexWrap='wrap';panel.style.maxWidth='calc(100vw - 40px)';panel.append(button,clear,label,feedback);document.body.append(panel);
 const reset=()=>{data.fill(0);texture.needsUpdate=true;snowInteractionUniforms.uTrackOn.value=0;anchored=false;feedback.textContent='Tocá para marcar · arrastrá para mover';refresh();};
 button.onclick=()=>{enabled=!enabled;button.textContent=enabled?'Huellas: tocá la nieve':'Huellas: desactivadas';};clear.onclick=reset;
 const ray=new THREE.Raycaster(),p=new THREE.Vector3();
 const stamp=(event:PointerEvent)=>{
  if(!enabled&&!event.shiftKey)return;const t=getTerrain();if(!t)return;
  const {width:w,height:h,cellSizeM:cell}=t.grid;
  const sample=(x:number,z:number)=>{const step=cell*2,gx=(x+t.widthM/2)/step,gy=(z+t.depthM/2)/step,ix=Math.floor(gx),iy=Math.floor(gy);if(ix<0||iy<0||ix>=t.meshSize.width-1||iy>=t.meshSize.height-1)return NaN;const u=gx-ix,v=gy-iy,a=t.heightsM[iy*2*w+ix*2],b=t.heightsM[iy*2*w+(ix+1)*2],c=t.heightsM[(iy+1)*2*w+ix*2],d=t.heightsM[(iy+1)*2*w+(ix+1)*2];return (u+v<=1?a*(1-u-v)+b*u+c*v:d*(u+v-1)+b*(1-v)+c*(1-u))*getScale();};
  const rect=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
  let previous=NaN,previousD=0,hit=false;
  for(let d=0;d<16000;d+=Math.max(2,cell*.5)){ray.ray.at(d,p);const diff=p.y-sample(p.x,p.z);if(Number.isFinite(previous)&&previous>0&&diff<=0){let lo=previousD,hi=d;for(let k=0;k<14;k++){const mid=(lo+hi)*.5;ray.ray.at(mid,p);if(p.y>sample(p.x,p.z))lo=mid;else hi=mid;}ray.ray.at((lo+hi)*.5,p);hit=true;break;}previous=diff;previousD=d;}
  if(!hit||p.y<((t.seaLevelM??0)+1)*getScale()){feedback.textContent='Tocá una superficie de nieve, fuera del agua';return;}
  const slope=Math.hypot(sample(p.x+cell,p.z)-sample(p.x-cell,p.z),sample(p.x,p.z+cell)-sample(p.x,p.z-cell))/(2*cell*getScale());if(!Number.isFinite(slope)||slope>.75){feedback.textContent='Elegí nieve con menos pendiente';return;}
  const radius=Number(size.value);
  const area=snowInteractionUniforms.uTrackArea.value;
  if(!anchored){area.set(p.x,p.z,SIZE);anchored=true;}
  if(Math.abs(p.x-area.x)>SIZE/2-radius*2||Math.abs(p.z-area.y)>SIZE/2-radius*2){data.fill(0);area.set(p.x,p.z,SIZE);}
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const wx=area.x+((x+.5)/N-.5)*SIZE,wz=area.y+((y+.5)/N-.5)*SIZE;const r=Math.hypot((wx-p.x)/(radius*.55),(wz-p.z)/radius);if(r<1){const v=1-r*r;data[y*N+x]=Math.max(data[y*N+x],Math.round(v*v*255));}}
  feedback.textContent='Huella aplicada · '+radius+' m (escala diorama)';texture.needsUpdate=true;snowInteractionUniforms.uTrackOn.value=1;refresh();
 };
 const onDown=(e:PointerEvent)=>{down={x:e.clientX,y:e.clientY,id:e.pointerId};};
 const onUp=(e:PointerEvent)=>{if(down&&down.id===e.pointerId&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<6)stamp(e);down=null;};
 const onCancel=()=>{down=null;};
 canvas.addEventListener('pointerdown',onDown,true);canvas.addEventListener('pointerup',onUp,true);canvas.addEventListener('pointercancel',onCancel,true);
 window.addEventListener('pagehide',()=>{canvas.removeEventListener('pointerdown',onDown,true);canvas.removeEventListener('pointerup',onUp,true);canvas.removeEventListener('pointercancel',onCancel,true);texture.dispose();panel.remove();},{once:true});
 return {reset};
}
