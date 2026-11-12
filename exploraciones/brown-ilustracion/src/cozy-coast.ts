/** Bounded artistic correction of coastal column heights; XY and tile seams stay fixed. */
export function cozyCoast(source:Float32Array,index:Uint32Array,cell:number,tile:number,halfX:number,halfZ:number){
 const out=source.slice(),columns=new Map<string,{ids:number[];top:number;near:Set<string>}>();
 const key=(i:number)=>source[i]+','+source[i+2];
 for(let i=0;i<source.length;i+=3){const k=key(i);let c=columns.get(k);if(!c){c={ids:[],top:-Infinity,near:new Set()};columns.set(k,c);}c.ids.push(i);c.top=Math.max(c.top,source[i+1]);}
 for(let j=0;j<index.length;j+=3){const ids=[index[j]*3,index[j+1]*3,index[j+2]*3],keys=[...new Set(ids.map(key))];if(keys.length!==2)continue;columns.get(keys[0])!.near.add(keys[1]);columns.get(keys[1])!.near.add(keys[0]);}
 for(const c of columns.values()){
  if(c.near.size!==2)continue;const i=c.ids[0],x=source[i]+halfX,z=source[i+2]+halfZ;
  const seam=(v:number)=>Math.abs(v/(cell*tile)-Math.round(v/(cell*tile)))<1e-5;
  if(seam(x)||seam(z))continue;
  const neighbors=[...c.near].map(k=>columns.get(k)!);const a=neighbors[0].top,b=neighbors[1].top;
  // Only isolated local peaks/valleys, not continuous cliff slopes.
  if((c.top-a)*(c.top-b)<=0)continue;
  const change=Math.max(-cell*.5,Math.min(cell*.5,((a+b)*.5-c.top)*.45));
  if(c.top+change<=Math.min(...c.ids.map(id=>source[id+1]))+1)continue;
  for(const id of c.ids)if(Math.abs(source[id+1]-c.top)<.001)out[id+1]+=change;
 }
 return out;
}
