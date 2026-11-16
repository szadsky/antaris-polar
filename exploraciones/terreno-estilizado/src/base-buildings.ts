import * as THREE from 'three';
import {mountBuildingControls} from './view-controls';
import type {Terrain,TerrainMeta} from './terrain';
import {projectedToTerrain,sampleTerrainHeight} from './terrain-coordinates';
type Footprint={id:string;properties:Record<string,unknown>;rings:number[][][]};
type Data={baseId:string;crs:string;metadata:{dataset:string;license:string;doi:string};buildings:Footprint[]};
export function createBaseBuildings(baseId:string,baseName:string,scene:THREE.Scene,camera:THREE.PerspectiveCamera,controls:{target:THREE.Vector3;update():void},redraw:()=>void){
 const root=new THREE.Group();root.name=baseId+'-building-footprints';scene.add(root);
 const lineMaterial=new THREE.LineBasicMaterial({color:'#f06d31',depthTest:true});
 const wallMaterial=new THREE.MeshStandardMaterial({color:'#bb4932',roughness:.85});
 const roofMaterial=new THREE.MeshStandardMaterial({color:'#e3e8ed',roughness:.9});
 const panel=document.createElement('details');panel.className='polar-details base-buildings';panel.open=true;
 panel.innerHTML='<summary>Edificios · Brown</summary><div class="panel-content buildings-content"><div class="control-section" data-building-controls></div><p class="hud__help building-status" data-result role="status">Cargando contornos…</p><div class="building-source"><p class="hud__help">Huellas históricas de 2005–2017, actualizadas en 2019. Alturas y techos aproximados.</p><p class="hud__help">AADC · CC BY 4.0</p></div></div>';
 panel.querySelector('summary')!.textContent='Edificios · '+baseName.replace(/^Base (Antártica )?/, '');
 document.querySelector('aside')?.append(panel);
 const body=panel.querySelector<HTMLElement>('.building-source')!;
 const credit=document.createElement('a');credit.href='https://doi.org/10.26179/5dc8db48eb58e';credit.textContent='Consultar fuente de los edificios ↗';credit.target='_blank';credit.rel='noopener';body.append(credit);
 const result=panel.querySelector('[data-result]')!;
 let mode='solid',height=3;
 let data:Data|null=null,terrain:Terrain|null=null,meta:TerrainMeta|null=null,k=1,disposed=false;
 const abort=new AbortController();let focus=new THREE.Vector3(),span=100;
 const clear=()=>{root.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Line)o.geometry.dispose();});root.clear();};
 function rebuild(){
  clear();root.scale.y=k;root.visible=mode!=='off';
  if(!data||!terrain||!meta)return;
  const t=terrain,L=t.level,points:THREE.Vector3[]=[],bounds=new THREE.Box3();let valid=0,missing=0,steep=0;
  const wallHeight=THREE.MathUtils.clamp(height,1,12);
  for(const b of data.buildings){
   const rings=b.rings.map(r=>r.map(([X,Y])=>projectedToTerrain(X,Y,meta!.origin,L.cellSizeM,t.widthM,t.depthM)));
   const draped:THREE.Vector3[][]=[];let incomplete=false;
   for(const ring of rings){const out:THREE.Vector3[]=[];
    for(let i=0;i<ring.length-1;i++){const a=ring[i],b=ring[i+1],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)));
     for(let j=0;j<steps;j++){const f=j/steps,col=THREE.MathUtils.lerp(a.col,b.col,f),row=THREE.MathUtils.lerp(a.row,b.row,f),h=sampleTerrainHeight(t.heightsM,L.width,L.height,col,row);
      if(h===null){incomplete=true;break;}out.push(new THREE.Vector3(THREE.MathUtils.lerp(a.x,b.x,f),h+.25,THREE.MathUtils.lerp(a.z,b.z,f)));}
     if(incomplete)break;
    }
    if(out.length)out.push(out[0].clone());draped.push(out);
   }
   if(incomplete||!draped[0]?.length){missing++;continue;}valid++;
   const ground=draped.flat().map(p=>p.y-.25),lo=Math.min(...ground),hi=Math.max(...ground);if(hi-lo>3)steep++;
   for(const p of draped[0]){bounds.expandByPoint(p);points.push(p);}
   if(mode!=='solid')for(const ring of draped)root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring),lineMaterial));
   else {
    // Work near each building's centre to retain precision in the extruded geometry.
    const cx=rings[0].slice(0,-1).reduce((s,p)=>s+p.x,0)/(rings[0].length-1),cz=rings[0].slice(0,-1).reduce((s,p)=>s+p.z,0)/(rings[0].length-1);
    const paths=rings.map(r=>r.slice(0,-1).map(p=>new THREE.Vector2(p.x-cx,-(p.z-cz))));
    const shape=new THREE.Shape(paths[0]);for(const hole of paths.slice(1))shape.holes.push(new THREE.Path(hole));
    // Flat foundation follows the highest perimeter sample; lower walls reach the slope.
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:hi-lo+wallHeight,bevelEnabled:false,steps:1});geometry.rotateX(-Math.PI/2);
    const mesh=new THREE.Mesh(geometry,wallMaterial);mesh.position.set(cx,lo,cz);mesh.name=b.id;mesh.userData={...b.properties,approximate:true,wallHeightM:wallHeight,terrainRangeM:hi-lo};root.add(mesh);
    const roof=new THREE.ExtrudeGeometry(shape,{depth:.35,steps:1,bevelEnabled:true,bevelSegments:1,bevelThickness:.18,bevelSize:.12});roof.rotateX(-Math.PI/2);
    const cap=new THREE.Mesh(roof,roofMaterial);cap.position.set(cx,hi+wallHeight,cz);root.add(cap);
   }
  }
  if(points.length){
   const base=projectedToTerrain(...meta.base.projected,meta.origin,L.cellSizeM,t.widthM,t.depthM);
   const nearby=points.filter(p=>Math.hypot(p.x-base.x,p.z-base.z)<500);
   if(nearby.length)bounds.setFromPoints(nearby);
   focus=bounds.getCenter(new THREE.Vector3());span=Math.max(50,bounds.getSize(new THREE.Vector3()).length());}
  result.textContent=`${valid}/${data.buildings.length} contornos con cobertura REMA${missing?` · ${missing} omitidos por falta de alturas`:''}${steep?` · ${steep} con desnivel >3 m: revisar coincidencia`:''}.`;
  root.userData={valid,missing,steep,mode:mode};redraw();
 }
 const focusBuildings=()=>{const target=focus.clone();target.y*=k;controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(span*.4,span*.65,span*.8));controls.update();redraw();};
 const disposeControls=mountBuildingControls(panel.querySelector<HTMLElement>('[data-building-controls]')!,{onMode(v){mode=v;rebuild();},onHeight(v){height=v;rebuild();},onFocus:focusBuildings});
 void fetch(`${import.meta.env.BASE_URL}terreno/${baseId}/buildings.json`,{signal:abort.signal}).then(async r=>{if(!r.ok)throw Error('No se pudieron cargar los contornos');const d:Data=await r.json();if(d.baseId!==baseId)throw Error('Los edificios no corresponden a esta base');if(d.crs!=='EPSG:3031')throw Error('Proyección incompatible');if(disposed)return;data=d;rebuild();}).catch(e=>{if(!disposed)result.textContent=String(e);});
 return {setTerrain(t:Terrain,m:TerrainMeta,scale:number){terrain=t;meta=m;k=scale;rebuild();},setExaggeration(scale:number){k=scale;root.scale.y=k;},dispose(){disposed=true;abort.abort();disposeControls();clear();scene.remove(root);lineMaterial.dispose();wallMaterial.dispose();roofMaterial.dispose();panel.remove();}};
}
