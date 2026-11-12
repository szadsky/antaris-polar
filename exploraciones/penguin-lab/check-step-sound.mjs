import assert from 'node:assert/strict';
import {synthSnowStep,STEP_PEAK} from './src/snow-step-synth.ts';
/** Espectro (FFT radix 2, ventana de Hann) y medidas de una pisada. Exportada para comparar otras muestras. */
export function analyze(d,sr){
 const N=8192,re=new Float64Array(N),im=new Float64Array(N);
 for(let n=0;n<N;n++)re[n]=(d[n]||0)*(0.5-0.5*Math.cos(2*Math.PI*n/N));
 for(let i=1,j=0;i<N;i++){let bit=N>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
 for(let len=2;len<=N;len<<=1){const ang=-2*Math.PI/len;for(let i=0;i<N;i+=len)for(let k=0;k<len/2;k++){const wr=Math.cos(ang*k),wi=Math.sin(ang*k),a=i+k,b=a+len/2,vr=re[b]*wr-im[b]*wi,vi=re[b]*wi+im[b]*wr;re[b]=re[a]-vr;im[b]=im[a]-vi;re[a]+=vr;im[a]+=vi;}}
 let tot=0,cen=0,low=0,mid=0,high=0;
 for(let k=1;k<N/2;k++){const f=k*sr/N,p=re[k]**2+im[k]**2;tot+=p;cen+=f*p;if(f<400)low+=p;else if(f<5000)mid+=p;else high+=p;}
 // Granulosidad: cuánto fluctúa la energía de cada milisegundo respecto de la envolvente suave (±5 ms),
 // donde la pisada suena (>10 % del máximo). Un siseo de ruido blanco da ~0,1; un crujido de granos, más.
 const w=Math.round(sr*.001),rms=[];for(let i=0;i<d.length;i+=w){let s=0;for(let j=i;j<i+w&&j<d.length;j++)s+=d[j]**2;rms.push(Math.sqrt(s/w));}
 const top=Math.max(...rms),ratios=[];
 for(let i=0;i<rms.length;i++){let s=0,c=0;for(let k=Math.max(0,i-5);k<=Math.min(rms.length-1,i+5);k++){s+=rms[k];c++;}const env=s/c;if(env>top*.1)ratios.push(rms[i]/env);}
 const mr=ratios.reduce((s,v)=>s+v,0)/ratios.length,grain=Math.sqrt(ratios.reduce((s,v)=>s+(v-mr)**2,0)/ratios.length);
 let peak=0;for(const v of d)peak=Math.max(peak,Math.abs(v));
 return {centroid:cen/tot,low:low/tot,mid:mid/tot,high:high/tot,grain,peak,first:Math.abs(d[0]),last:Math.abs(d[d.length-1])};
}
const sr=48000,steps=Array.from({length:12},(_,i)=>synthSnowStep(i,sr)),A=steps.map(s=>analyze(s,sr));
// Referencia: ruido blanco con la misma envolvente (siseo puro) para calibrar la granulosidad.
const hiss=Float32Array.from({length:Math.round(sr*.25)},(_,i)=>(Math.random()*2-1)*Math.exp(-i/sr/.08)),H=analyze(hiss,sr);
for(const a of A){
 // Crujido: el centro del espectro entre 0,9 y 3 kHz (la muestra anterior: 513 Hz, un golpe sordo).
 assert(a.centroid>900&&a.centroid<3000,`Centroid ${a.centroid.toFixed(0)} Hz`);
 // Suave: casi nada por encima de 5 kHz y poco retumbo bajo 400 Hz; la mayor parte en 0,4–5 kHz.
 assert(a.high<.06,`Harsh highs: ${(a.high*100).toFixed(1)} %`);assert(a.low<.3,`Boomy lows: ${(a.low*100).toFixed(1)} %`);assert(a.mid>.6);
 // Granos de crujido, no siseo uniforme: al menos el triple de granulosidad que el ruido blanco.
 assert(a.grain>H.grain*3,`Too hiss-like: granularity ${a.grain.toFixed(2)} (white noise ${H.grain.toFixed(2)})`);
 // Sin saturación ni clics en los bordes.
 assert(Math.abs(a.peak-STEP_PEAK)<1e-6);assert(a.first<1e-3&&a.last<1e-2,'Clicks at the edges');
}
// Variedad: dos pisadas seguidas nunca son iguales (correlación < 0,5).
const corr=(a,b)=>{let s=0,na=0,nb=0;for(let i=0;i<Math.min(a.length,b.length);i++){s+=a[i]*b[i];na+=a[i]**2;nb+=b[i]**2;}return Math.abs(s)/Math.sqrt(na*nb);};
for(let i=1;i<steps.length;i++)assert(corr(steps[i-1],steps[i])<.5,'Consecutive steps too similar');
const mean=k=>A.reduce((s,a)=>s+a[k],0)/A.length;
console.log(`PASS: pisada de nieve sintetizada · centro ${mean('centroid').toFixed(0)} Hz (antes 513) · 0,4–5 kHz ${(mean('mid')*100).toFixed(0)} % · agudos >5 kHz ${(mean('high')*100).toFixed(1)} % · graves <400 Hz ${(mean('low')*100).toFixed(0)} % · granulosidad ${mean('grain').toFixed(2)} (siseo ${H.grain.toFixed(2)}) · pico ${STEP_PEAK} (antes 0,91) · 12 variantes distintas.`);
