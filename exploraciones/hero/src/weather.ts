import { SelectControl } from 'dialkit/vanilla';
import 'dialkit/vanilla/styles.css';
import locations from './weather-locations.json';
import './weather.css';

type Conditions = { temperature_2m: number; weather_code: string; is_day: number; wind_speed_10m: number; time: number };
const REFRESH = 3 * 60 * 60 * 1000;
const cloud = '<path d="M16 40h29a11 11 0 0 0 0-22 16 16 0 0 0-30-1 12 12 0 0 0 1 23Z" fill="#f3fbff" stroke="#83a5b9" stroke-width="2"/>';
export function weatherKind(code: string): {label:string;kind:string} {
  if (code.includes('thunder')) return {label:'Tormenta',kind:'storm'};
  if (code.includes('snow')) return {label:'Nieve',kind:'snow'};
  if (code.includes('sleet')) return {label:'Aguanieve',kind:'snow'};
  if (code.includes('rain')) return {label:'Lluvia',kind:'rain'};
  if (code.includes('fog')) return {label:'Niebla',kind:'fog'};
  if (code.includes('clearsky')) return {label:'Despejado',kind:'sun'};
  if (code.includes('partlycloudy') || code.includes('fair')) return {label:'Parcialmente nublado',kind:'partly'};
  if (code.includes('cloudy')) return {label:'Nublado',kind:'cloud'};
  return {label:'Estado no disponible',kind:'unknown'};
}
type Forecast = { time: string; data: { instant: { details: { air_temperature: number; wind_speed: number } }; next_1_hours?: { summary: { symbol_code: string } }; next_6_hours?: { summary: { symbol_code: string } } } };
type Cached = { expires: number; series: Forecast[] };
const memory = new Map<string, Cached>();
async function officialForecast(place: typeof locations[number]): Promise<Conditions|null> {
  const key='antaris-met-v1-'+place.id;
  let cached=memory.get(key);
  if(!cached) { try {const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&Array.isArray(saved.series)&&Number.isFinite(saved.expires)) cached=saved;}catch{/* Storage is optional. */} }
  if(!cached || cached.expires<Date.now()) {
    const query=new URLSearchParams({lat:place.lat.toFixed(4),lon:place.lon.toFixed(4)});
    const response=await fetch('https://api.met.no/weatherapi/locationforecast/2.0/compact?'+query,{signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw Error('Official forecast unavailable');
    const payload=await response.json();
    if(!Array.isArray(payload?.properties?.timeseries)) throw Error('Invalid forecast');
    cached={expires:Date.now()+REFRESH,series:payload.properties.timeseries};
    try{localStorage.setItem(key,JSON.stringify(cached));}catch{/* Memory cache still works. */}
  }
  memory.set(key,cached);
  const nearest=cached.series.reduce<Forecast|null>((best,item)=>!best||Math.abs(Date.parse(item.time)-Date.now())<Math.abs(Date.parse(best.time)-Date.now())?item:best,null);
  if(!nearest||Math.abs(Date.parse(nearest.time)-Date.now())>90*60*1000) return null;
  const detail=nearest.data?.instant?.details;
  if(!detail||!Number.isFinite(detail.air_temperature)||!Number.isFinite(detail.wind_speed)) return null;
  const code=nearest.data.next_1_hours?.summary?.symbol_code ?? nearest.data.next_6_hours?.summary?.symbol_code ?? '';
  return {temperature_2m:detail.air_temperature,wind_speed_10m:detail.wind_speed*3.6,weather_code:code,is_day:code.endsWith('_night')?0:1,time:Date.parse(nearest.time)/1000};
}

function illustration(kind:string, day:boolean) {
  const sun = day ? '<circle cx="23" cy="22" r="11" fill="#f5ce76"/><path d="M23 5v-3m0 40v-3M6 22H3m40 0h-3M11 10l-2-2m28 28-2-2m2-26-2 2M9 36l2-2" stroke="#e5b758" stroke-width="2" stroke-linecap="round"/>' : '<path d="M32 8a17 17 0 1 0 9 28A19 19 0 0 1 32 8Z" fill="#b0c9ea"/>';
  const extra = kind==='snow' ? '<path d="M21 47v10m-4-8 8 6m0-6-8 6m23-8v10m-4-8 8 6m0-6-8 6" stroke="#719bb4" stroke-width="2" stroke-linecap="round"/>' : kind==='rain' ? '<path d="m21 47-3 8m14-8-3 8m14-8-3 8" stroke="#6ba5c7" stroke-width="3" stroke-linecap="round"/>' : kind==='storm' ? '<path d="m32 40-7 11h8l-4 10 14-15h-9l4-6" fill="#e6b95b"/>' : kind==='fog' ? '<path d="M12 47h40M18 54h28" stroke="#8ca9b9" stroke-width="3" stroke-linecap="round"/>' : '';
  return `<svg viewBox="0 0 64 64" width="56" height="56" fill="none" aria-hidden="true">${kind==='unknown'?'<circle cx="32" cy="30" r="15" stroke="#9eb5c4" stroke-width="2" stroke-dasharray="3 5"/>':(kind==='sun'||kind==='partly'?sun:'')+(kind!=='sun'?cloud:'')+extra}</svg>`;
}
export function mountWeather() {
  const host = document.querySelector<HTMLElement>('.hero-weather');
  if (!host) return;
  host.innerHTML = `<div class="weather-card"><div class="weather-place" data-city><span class="weather-place__name">Ushuaia</span><div class="weather-reading"><span class="weather-art"></span><strong class="weather-temp">—</strong></div><span class="weather-condition">Consultando clima…</span><span class="weather-wind"></span></div><div class="weather-place" data-base><div class="weather-select"></div><div class="weather-reading"><span class="weather-art"></span><strong class="weather-temp">—</strong></div><span class="weather-condition">Consultando clima…</span><span class="weather-wind"></span></div></div><p class="weather-source"><a href="https://www.met.no/en" target="_blank" rel="noopener noreferrer">MET Norway</a> · Pronóstico horario <span class="weather-time"></span> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" title="Datos CC BY 4.0; temperaturas redondeadas y viento convertido a km/h">CC BY 4.0</a></p>`;
  let index=1, paused=matchMedia('(prefers-reduced-motion: reduce)').matches, hovered=false;
  let data: Array<Conditions|null>=[], loading=true, failed=false, inFlight=false;
  const fmt = new Intl.NumberFormat('es-AR',{maximumFractionDigits:0});
  document.body.classList.add('weather-dial-theme');
  const selectProps = {
    label: 'Base antártica', value: String(index),
    options: locations.slice(1).map((l,i)=>({value:String(i+1),label:l.nombre})),
    onChange(value:string) {index=Number(value);render();void refresh();},
  };
  const select = SelectControl(host.querySelector<HTMLElement>('.weather-select')!, selectProps);
  function render() {
    select.update({...selectProps,value:String(index)});
    for (const [selector,n] of [['[data-city]',0],['[data-base]',index]] as const) {
      const panel=host!.querySelector<HTMLElement>(selector)!;
      const d=data[n];
      const usable=d && Date.now()-d.time*1000 < 90*60*1000;
      const w=usable?weatherKind(d.weather_code):{label:loading?'Consultando clima…':'Sin datos disponibles',kind:'unknown'};
      panel.querySelector('.weather-art')!.innerHTML=illustration(w.kind,usable?d.is_day===1:true);
      panel.querySelector('.weather-temp')!.textContent=usable?fmt.format(Math.round(d.temperature_2m)||0)+'°':'—';
      panel.querySelector('.weather-temp')!.setAttribute('aria-label',usable?fmt.format(d.temperature_2m)+' grados Celsius':'Temperatura no disponible');
      panel.querySelector('.weather-condition')!.textContent=w.label;
      panel.querySelector('.weather-wind')!.textContent=usable?'Viento '+fmt.format(d.wind_speed_10m)+' km/h':'';
    }
    const a=data[0],b=data[index];
    const valid=a&&b&&[a,b].every(d=>Date.now()-d.time*1000<90*60*1000);
    host!.querySelector('.weather-time')!.textContent=valid?'· '+new Intl.DateTimeFormat('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(new Date(Math.min(a.time,b.time)*1000))+' UTC'+(failed?' · Sin actualizar':''):'';
  }
  async function refresh() {
    if(inFlight) return;
    inFlight=true;
    const requested=index;
    const results=await Promise.allSettled([officialForecast(locations[0]),officialForecast(locations[requested])]);
    failed=results.some(r=>r.status==='rejected');
    for(const [i,result] of results.entries()) data[i===0?0:requested]=result.status==='fulfilled'?result.value:null;
    loading=false;inFlight=false;render();
  }
  host.addEventListener('pointerenter',()=>{hovered=true;});host.addEventListener('pointerleave',()=>{hovered=false;});
  const timer=window.setInterval(()=>{
    if(document.hidden) return;
    if(!paused&&!hovered&&!host.contains(document.activeElement)&&!host.querySelector('[aria-expanded="true"]')){index=index%(locations.length-1)+1;render();}
    void refresh();
  },10000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);select.destroy();},{once:true});
  render();void refresh();
}
