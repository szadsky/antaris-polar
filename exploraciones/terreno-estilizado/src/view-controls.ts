import { SelectControl, SegmentedControl } from "dialkit/vanilla";
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
  select("base","Base");
  select("exaggeration","Altura del relieve");
  select("quality","Calidad gráfica");
  const syncMaterial=select("material","Material");
  const props={options:[{value:"base",label:"Relieve base"},{value:"estilizado",label:"Interpretación"}],
    value:style(),onChange:(v:string)=>setStyle(v as "base"|"estilizado")};
  const segment=SegmentedControl(host("dial-style"),props);
  return ()=>{segment.update({...props,value:style()});syncMaterial();};
}

