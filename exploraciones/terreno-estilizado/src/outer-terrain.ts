import * as THREE from "three";
import type { Terrain } from "./terrain";

// Each square perimeter is sampled clockwise, starting at its north-west corner.
export function outerTerrain(t: Terrain, heights: Int16Array, minimum: number) {
  const positions: number[] = [], indices: number[] = [];
  const valid: boolean[] = [];
  function vertex(x:number, z:number, h:number) {
    const id=valid.length;
    valid.push(Number.isFinite(h));
    positions.push(x,valid[id]?h:0,z);
    return id;
  }
  function join(a:number[], b:number[]) {
    let i=0,j=0;
    function face(p:number,q:number,r:number) {
      if(valid[p] && valid[q] && valid[r] && Math.max(positions[p*3+1],positions[q*3+1],positions[r*3+1]) >= (t.seaLevelM??0)-.03)
        indices.push(p,q,r);
    }
    while(i<a.length || j<b.length) {
      const p=a[i%a.length], q=b[j%b.length];
      if((i+1)*b.length <= (j+1)*a.length && i<a.length) {
        face(p,a[++i%a.length],q);
      } else {
        face(p,b[(j+1)%b.length],q);
        j++;
      }
    }
  }
  function ring(n:number,r:number,height:(x:number,z:number)=>number) {
    const row:number[]=[];
    for(let side=0;side<4;side++) for(let k=0;k<n;k++){
      const u=2*k/n-1;
      const x=[u,1,-u,-1][side],z=[-1,u,1,-u][side];
      row.push(vertex(x*r,z*r,height(x,z)));
    }
    return row;
  }
  const n=t.meshSize.width-1;
  let prev=ring(n,t.widthM/2,(x,z)=>t.heightsM[Math.round((z+1)*n)*t.level.width+Math.round((x+1)*n)]);
  for(let r=67;r<=100;r++){
    const next=ring(2*r,r*60,(x,z)=>{
      const h=heights[(100+Math.round(z*r))*201+100+Math.round(x*r)];
      return h===-32768?NaN:h/10-minimum;
    });
    join(prev,next);
    prev=next;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const normals=geo.getAttribute("normal"), colors:number[]=[];
  const snow=new THREE.Color("#e6edf0"),rock=new THREE.Color("#53606a"),c=new THREE.Color();
  for(let i=0;i<normals.count;i++) c.copy(rock).lerp(snow,THREE.MathUtils.smoothstep(normals.getY(i),.53,.86)).toArray(colors,3*i);
  geo.setAttribute("color",new THREE.Float32BufferAttribute(colors,3));
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1});
  material.onBeforeCompile=shader=>{
    shader.vertexShader="varying vec2 outerXZ;\n"+shader.vertexShader.replace("#include <begin_vertex>","#include <begin_vertex>\nouterXZ=position.xz;");
    shader.fragmentShader="varying vec2 outerXZ;\n"+shader.fragmentShader.replace("#include <fog_fragment>","#include <fog_fragment>\n#ifdef USE_FOG\ngl_FragColor.rgb=mix(gl_FragColor.rgb,fogColor,smoothstep(5050.,5990.,max(abs(outerXZ.x),abs(outerXZ.y))));\n#endif");
  };
  return new THREE.Mesh(geo,material);
}
