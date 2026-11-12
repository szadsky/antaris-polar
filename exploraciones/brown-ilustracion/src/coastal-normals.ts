export function coastalNormals(source: Float32Array, sourceIndex: Uint32Array) {
  const sides: number[] = [];
  for(let j=0;j<sourceIndex.length;j+=3){
    const a=sourceIndex[j]*3,b=sourceIndex[j+1]*3,c=sourceIndex[j+2]*3;
    const ux=source[b]-source[a],uz=source[b+2]-source[a+2],vx=source[c]-source[a],vz=source[c+2]-source[a+2];
    // Baked closures are vertical in world coordinates, independent of camera/pixels.
    if(Math.abs(uz*vx-ux*vz)<1e-10)sides.push(j);
  }
  const positions=new Float32Array(source.length+sides.length*9);
  positions.set(source);
  const normals=new Float32Array(positions.length),index=sourceIndex.slice();
  for(let i=1;i<source.length;i+=3)normals[i]=1;
  let next=source.length/3;
  for(const j of sides){
    const a=sourceIndex[j]*3,b=sourceIndex[j+1]*3,c=sourceIndex[j+2]*3;
    const ux=source[b]-source[a],uy=source[b+1]-source[a+1],uz=source[b+2]-source[a+2];
    const vx=source[c]-source[a],vy=source[c+1]-source[a+1],vz=source[c+2]-source[a+2];
    const nx=uy*vz-uz*vy,nz=ux*vy-uy*vx,len=Math.hypot(nx,nz);
    if(!Number.isFinite(len)||len===0)throw Error('Cara costera degenerada');
    for(let k=0;k<3;k++){
      const old=sourceIndex[j+k]*3;
      positions.set(source.subarray(old,old+3),next*3);
      normals[next*3]=nx/len;normals[next*3+2]=nz/len;
      index[j+k]=next++;
    }
  }
  return {positions,index,normals};
}
