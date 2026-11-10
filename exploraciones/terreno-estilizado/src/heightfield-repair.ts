export interface HeightfieldRepair { indices:Uint32Array; sources:Uint8Array; remaining:number; unresolved:{minX:number;minY:number;maxX:number;maxY:number;count:number}[] }
/** 1 = aligned measured coverage; 2 = bounded interpolation. Never writes a finite input. */
export function repairHeightfield(heights:Float32Array,width:number,height:number,land:Uint8Array|null,coverage?:Float32Array):HeightfieldRepair{
  if(heights.length!==width*height||coverage&&coverage.length!==heights.length)throw Error('Coverage grid mismatch');
  const changed:number[]=[],sources:number[]=[];let missing=0;
  for(let i=0;i<heights.length;i++)if(!Number.isFinite(heights[i])){if(coverage&&Number.isFinite(coverage[i])){heights[i]=coverage[i];changed.push(i);sources.push(1);}else missing++;}
  if(!missing)return {indices:Uint32Array.from(changed),sources:Uint8Array.from(sources),remaining:0,unresolved:[]};
  const interpolated=new Set<number>();
  const visited=new Uint8Array(heights.length),unresolved:HeightfieldRepair['unresolved']=[];
  for(let first=0;first<heights.length;first++){
    if(visited[first]||Number.isFinite(heights[first]))continue;
    const component=[first];visited[first]=1;let minX=width,minY=height,maxX=0,maxY=0,safe=!!land;
    for(let head=0;head<component.length;head++){
      const i=component[head],x=i%width,y=Math.floor(i/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      if(x===0||y===0||x===width-1||y===height-1||!land?.[i])safe=false;
      for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1]]){const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;const n=yy*width+xx;if(!land?.[n])safe=false;if(!Number.isFinite(heights[n])&&!visited[n]){visited[n]=1;component.push(n);}}
    }
    const fill:number[]=[];
    if(safe&&component.length<=4&&maxX-minX<3&&maxY-minY<3){
      for(const i of component){const x=i%width,y=Math.floor(i/width);const estimates:number[]=[];
        for(const [dx,dy]of [[1,0],[0,1]]){const ends:{v:number;d:number}[]=[];for(const sign of [-1,1])for(let d=1;d<=3;d++){const xx=x+dx*sign*d,yy=y+dy*sign*d;if(xx<0||xx>=width||yy<0||yy>=height)break;const n=yy*width+xx;if(!land?.[n])break;if(Number.isFinite(heights[n])&&!interpolated.has(n)){ends.push({v:heights[n],d});break;}}
          if(ends.length===2)estimates.push((ends[0].v*ends[1].d+ends[1].v*ends[0].d)/(ends[0].d+ends[1].d));
        }
        // Require support in both axes and reject conflicting cliff-side estimates.
        if(estimates.length!==2||Math.abs(estimates[0]-estimates[1])>2){safe=false;break;}fill.push((estimates[0]+estimates[1])/2);
      }
    }else safe=false;
    if(safe){component.forEach((i,k)=>{heights[i]=fill[k];interpolated.add(i);changed.push(i);sources.push(2);});missing-=component.length;}
    else unresolved.push({minX,minY,maxX,maxY,count:component.length});
  }
  return {indices:Uint32Array.from(changed),sources:Uint8Array.from(sources),remaining:missing,unresolved};
}
