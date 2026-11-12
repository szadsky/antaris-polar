import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Terrain } from "./terrain";

// Exhibition support; the only vertical faces follow the outside of the square.
// Profundidad del corte lateral bajo el agua y alto del zócalo, en fracción del ancho del bloque (8 km → 384 m y
// 200 m). Antes 0,022 y 0,018 (176 m y 144 m): desde la vista general el bloque se veía como una lámina fina.
const SECTION_DEPTH = 0.048;
const FOOTING_HEIGHT = 0.025;

// Fondo del mar en el corte (reconstrucción artística: no hay batimetría medida en estos recortes). Empalma con el
// fondo que ya dibuja el terreno junto a la costa (1,5 m en la orilla, 30 m a 100 m; worker.ts, SEABED_*) y sigue
// bajando en curva hasta ~85 % del corte, con ondulaciones suaves (rellanos y escalones) a lo largo del borde.
function seabedDepth(dM: number, s: number, maxM: number) {
  const near = Math.min(30, 1.5 + dM * 0.285);
  const far = maxM * 0.85 * (1 - Math.exp(-dM / 700));
  const base = Math.max(near, far);
  const wave = (smoothNoise(s / 420) - 0.5) * 0.35 + (smoothNoise(s / 130 + 7.3) - 0.5) * 0.12;
  const k = THREE.MathUtils.smoothstep(dM, 60, 250); // junto a la orilla, sin ondulación (empalme con el terreno)
  return THREE.MathUtils.clamp(base * (1 + wave * k), 1.5, maxM * 0.92);
}
function hash1(i: number) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function smoothNoise(x: number) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }

export function createDiorama(withFooting = true) {
  const group=new THREE.Group();
  const footing=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:0x243941,roughness:.78}));
  // Corte lateral. La roca, con el MISMO material de las montañas: el de la malla costera del relieve
  // ("terreno-rema"). Sus caras verticales con normal horizontal entran por el camino de "caras de cierre" del
  // shader (roca con la normal de la cara, luz del sol y del cielo, sin nieve ni hielo), igual que los frentes
  // de acantilado; si cambia el estilo o la variante, el corte la sigue. Bajo el mar, la roca sube en curva hasta
  // la orilla y el agua queda por encima, con su degradé turquesa.
  const waterMaterial=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,fog:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
  const section=new THREE.Mesh<THREE.BufferGeometry,THREE.Material[]>(new THREE.BufferGeometry(),[waterMaterial,waterMaterial]);
  section.name="corte-diorama";
  let terrainMesh:THREE.Mesh|undefined;
  // Seguir el material del relieve (cambia con el estilo y la variante). Vale desde el cuadro siguiente.
  section.onBeforeRender=()=>{const m=terrainMesh?.material as THREE.Material|undefined;if(m&&section.material[0]!==m)section.material[0]=m;};
  const WATER_TOP=new THREE.Color("#4f97a6"),WATER_BOTTOM=new THREE.Color("#0c2a35");
  group.add(section);
  if(withFooting) group.add(footing);
  let current:Terrain|undefined;
  function update(t:Terrain,k:number) {
    terrainMesh=t.object.getObjectByName("terreno-rema") as THREE.Mesh|undefined;
    if(terrainMesh)section.material[0]=terrainMesh.material as THREE.Material;
    const {width,height}=t.meshSize,cell=t.level.cellSizeM*2,L=t.level;
    const sea=(t.seaLevelM??0)*k-.03,thickness=t.widthM*SECTION_DEPTH,bottomY=withFooting ? sea-thickness : sea-1;
    if(withFooting && current!==t){
      footing.geometry.dispose();
      footing.geometry=new RoundedBoxGeometry(t.widthM+cell*2,t.widthM*FOOTING_HEIGHT,t.depthM+cell*2,2,cell);
      current=t;
    }
    footing.position.y=sea-thickness-t.widthM*FOOTING_HEIGHT/2;
    // Distancia a la tierra más cercana (en celdas de malla, chaflán de dos pasadas): el fondo del corte baja con la
    // distancia a la costa en planta, no solo a lo largo del borde.
    const sampleAt=(x:number,z:number)=>t.heightsM[z*2*L.width+x*2];
    const isWater=(v:number)=>!Number.isFinite(v)||v*k<=sea+0.05;
    const D=new Float32Array(width*height);
    for(let z=0;z<height;z++)for(let x=0;x<width;x++)D[z*width+x]=isWater(sampleAt(x,z))?1e9:0;
    const S2=Math.SQRT2;
    for(let z=0;z<height;z++)for(let x=0;x<width;x++){const i=z*width+x;let d=D[i];if(x>0)d=Math.min(d,D[i-1]+1);if(z>0){d=Math.min(d,D[i-width]+1);if(x>0)d=Math.min(d,D[i-width-1]+S2);if(x<width-1)d=Math.min(d,D[i-width+1]+S2);}D[i]=d;}
    for(let z=height-1;z>=0;z--)for(let x=width-1;x>=0;x--){const i=z*width+x;let d=D[i];if(x<width-1)d=Math.min(d,D[i+1]+1);if(z<height-1){d=Math.min(d,D[i+width]+1);if(x<width-1)d=Math.min(d,D[i+width+1]+S2);if(x>0)d=Math.min(d,D[i+width-1]+S2);}D[i]=d;}

    // Por cada punto del borde: arriba (terreno o nivel del mar), techo de la roca (= arriba en tierra, fondo del
    // mar en el agua) y abajo.
    const pos:number[]=[],nor:number[]=[],uv:number[]=[],col:number[]=[],wet:boolean[]=[],tops:number[]=[],beds:number[]=[];
    // La malla costera del terreno cierra el bloque con su propia pared exactamente en el borde: si el corte
    // queda en el mismo plano, las dos se pelean por la profundidad (rayado vertical con huecos). El corte se
    // corre unos metros hacia afuera para taparla siempre; a la distancia del diorama no se nota el escalón.
    const out=Math.max(1,t.widthM*.0004);
    let arc=0;
    const water=new THREE.Color();
    const point=(x:number,z:number)=>{
      const sample=sampleAt(x,z),w=isWater(sample);
      const top=Number.isFinite(sample)?Math.max(sea,sample*k):sea;
      const depth=w?seabedDepth(D[z*width+x]*cell,arc,thickness):0;
      const bed=w?sea-depth:top;
      arc+=cell;
      const px=x*cell-t.widthM/2+(x===0?-out:x===width-1?out:0);
      const pz=z*cell-t.depthM/2+(z===0?-out:z===height-1?out:0);
      pos.push(px,top,pz,px,bed,pz,px,bottomY,pz);
      // normal horizontal exacta (y = 0): el shader del relieve la toma como cara vertical de cierre
      let nx=x===0?-1:x===width-1?1:0,nz=z===0?-1:z===height-1?1:0;const len=Math.hypot(nx,nz)||1;nx/=len;nz/=len;
      nor.push(nx,0,nz,nx,0,nz,nx,0,nz);
      // misma coordenada de textura que la malla del relieve en ese vértice (texturas de superficie y luz)
      const u=(x*2+.5)/L.width,v=(z*2+.5)/L.height;uv.push(u,v,u,v,u,v);
      water.copy(WATER_TOP).lerp(WATER_BOTTOM,Math.min(1,depth/thickness));
      col.push(WATER_TOP.r,WATER_TOP.g,WATER_TOP.b,water.r,water.g,water.b,WATER_BOTTOM.r,WATER_BOTTOM.g,WATER_BOTTOM.b);
      wet.push(w);tops.push(top);beds.push(bed);
    };
    for(let x=0;x<width;x++)point(x,0);
    for(let z=1;z<height;z++)point(width-1,z);
    for(let x=width-2;x>=0;x--)point(x,height-1);
    for(let z=height-2;z>0;z--)point(0,z);
    const n=wet.length,rock:number[]=[],sea_:number[]=[];
    const T=(i:number)=>3*i,B=(i:number)=>3*i+1,F=(i:number)=>3*i+2;
    // vértice extra donde el techo de la roca cruza el nivel del mar en un tramo tierra–agua
    const crossing=(land:number,wat:number)=>{
      const s=(tops[land]-sea)/Math.max(1e-3,tops[land]-beds[wat]),id=pos.length/3;
      for(let c=0;c<3;c++)pos.push(pos[B(land)*3+c]+(pos[B(wat)*3+c]-pos[B(land)*3+c])*s);
      for(let c=0;c<3;c++)nor.push(nor[B(land)*3+c]);
      for(let c=0;c<2;c++)uv.push(uv[B(land)*2+c]+(uv[B(wat)*2+c]-uv[B(land)*2+c])*s);
      col.push(WATER_TOP.r,WATER_TOP.g,WATER_TOP.b);
      return id;
    };
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      // roca: del techo (terreno o fondo del mar) hasta abajo
      rock.push(B(i),B(j),F(i),B(j),F(j),F(i));
      // agua: del nivel del mar al fondo
      if(wet[i]&&wet[j])sea_.push(T(i),T(j),B(i),T(j),B(j),B(i));
      else if(wet[j]&&tops[i]>sea){const c=crossing(i,j);sea_.push(T(j),B(j),c);}
      else if(wet[i]&&tops[j]>sea){const c=crossing(j,i);sea_.push(T(i),c,B(i));}
    }
    // Close the existing outward offset with a top collar instead of leaving a sky-visible slit.
    const topStart=pos.length/3;
    for(let i=0;i<n;i++){const a=T(i)*3;pos.push(Math.max(-t.widthM/2,Math.min(t.widthM/2,pos[a])),pos[a+1],Math.max(-t.depthM/2,Math.min(t.depthM/2,pos[a+2])));nor.push(0,1,0);uv.push(uv[T(i)*2],uv[T(i)*2+1]);col.push(col[a],col[a+1],col[a+2]);}
    for(let i=0;i<n;i++){const j=(i+1)%n,ia=topStart+i,ib=topStart+j;(wet[i]&&wet[j]?sea_:rock).push(T(i),ia,T(j),T(j),ia,ib);}
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute("normal",new THREE.Float32BufferAttribute(nor,3));
    g.setAttribute("surfUv",new THREE.Float32BufferAttribute(uv,2));
    g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
    g.setIndex([...rock,...sea_]);
    g.addGroup(0,rock.length,0);
    g.addGroup(rock.length,sea_.length,1);
    section.geometry.dispose();
    section.geometry=g;
  }
  return {group,update};
}
