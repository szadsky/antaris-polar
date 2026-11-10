import { ButtonGroup, SelectControl, SegmentedControl, Slider } from "dialkit/vanilla";
import "dialkit/vanilla/styles.css";

export function mountViewControls(style:()=>string, setStyle:(value:"base"|"estilizado")=>void) {
  const host=(id:string)=>document.getElementById(id)!;
  function select(id:string,label:string) {
    const source=host(id) as HTMLSelectElement;
    const props={
      label, value:source.value, options:Array.from(source.options,o=>({value:o.value,label:o.text})),
      onChange(value:string){source.value=value;source.dispatchEvent(new Event("change"));sync();}
    };
    const control=SelectControl(host("dial-"+id),props);
    const sync=()=>control.update({...props,value:source.value});
    source.addEventListener("change",sync);
    return sync;
  }
  const date=host("solar-date") as HTMLInputElement;
  const time=host("solar-time") as HTMLInputElement;
  function setInstant(instant:Date) {
    if(!Number.isFinite(instant.getTime())) return;
    const utc=instant.toISOString();
    date.value=utc.slice(0,10);
    time.value=utc.slice(11,16);
    time.dispatchEvent(new Event("change"));
  }
  // Hora del día como deslizador (UTC, pasos de 15 min = 0,25 h): mueve el sol en continuo.
  const hourOf=()=>{const [h,m]=time.value.split(":").map(Number);return Math.round(((h||0)+(m||0)/60)*4)/4;};
  const hourProps={label:"Hora (UTC)",value:hourOf(),min:0,max:23.75,step:0.25,unit:"h",
    onChange(v:number){
      const mins=Math.round(v*60), hh=String(Math.floor(mins/60)%24).padStart(2,"0"), mm=String(mins%60).padStart(2,"0");
      if(time.value===hh+":"+mm) return;
      time.value=hh+":"+mm;
      time.dispatchEvent(new Event("change"));
    }};
  const hourSlider=Slider(host("dial-solar-hour"),hourProps);
  const syncHour=()=>hourSlider.update({...hourProps,value:hourOf()});
  time.addEventListener("change",syncHour);
  date.addEventListener("change",syncHour);
  ButtonGroup(host("dial-solar"),{buttons:[
    {label:"Ahora",onClick:()=>setInstant(new Date())}
  ]});
  select("base","Base");
  select("exaggeration","Altura del relieve");
  select("quality","Calidad gráfica");
  const syncMaterial=select("material","Material");
  const props={options:[{value:"base",label:"Relieve base"},{value:"estilizado",label:"Interpretación"}],
    value:style(),onChange:(v:string)=>setStyle(v as "base"|"estilizado")};
  const segment=SegmentedControl(host("dial-style"),props);
  return ()=>{segment.update({...props,value:style()});syncMaterial();};
}


export function mountMarineControls(o:{visible:boolean;floating:boolean;onVisible:(v:boolean)=>void;onFloating:(v:boolean)=>void;onIntensity:(v:number)=>void;onView:()=>void;onSpeed:(v:number)=>void;onWaves:(v:number)=>void}){
 const host=(id:string)=>document.getElementById(id)!;
 Slider(host('dial-water-speed'),{label:'Velocidad del agua',value:1.0,min:.3,max:1.6,step:.05,onChange:o.onSpeed});
 Slider(host('dial-water-strength'),{label:'Ondulación del agua',value:1.0,min:.3,max:1.5,step:.05,onChange:o.onWaves});
 const visibleProps={label:'Mostrar icebergs',value:o.visible?'on':'off',options:[{value:'on',label:'Visibles'},{value:'off',label:'Ocultos'}],onChange:(v:string)=>o.onVisible(v==='on')};
 const visible=SelectControl(host('dial-berg-visible'),visibleProps);
 const motionProps={label:'Flotación',value:o.floating?'on':'off',options:[{value:'on',label:'En movimiento'},{value:'off',label:'En reposo'}],onChange:(v:string)=>o.onFloating(v==='on')};
 const motion=SelectControl(host('dial-berg-motion'),motionProps);
 Slider(host('dial-berg-strength'),{label:'Intensidad de flotación',value:1,min:.25,max:1.5,step:.05,onChange:o.onIntensity});
 ButtonGroup(host('dial-berg-view'),{buttons:[{label:'Ver siguiente iceberg',onClick:o.onView}]});
 return {sync(v:boolean,f:boolean){visible.update({...visibleProps,value:v?'on':'off'});motion.update({...motionProps,value:f?'on':'off'});},setAvailable(available:boolean){host('iceberg-settings').hidden=!available;}};
}
