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

