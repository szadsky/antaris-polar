/** Same pixel-centre and axis convention used by the REMA marker and mesh. */
export function projectedToTerrain(X:number,Y:number,origin:readonly number[],cell:number,widthM:number,depthM:number){
 const col=(X-origin[0])/cell-.5,row=(origin[1]-Y)/cell-.5;
 return {col,row,x:col*cell-widthM/2,z:row*cell-depthM/2};
}
export function sampleTerrainHeight(heights:Float32Array,width:number,height:number,col:number,row:number):number|null{
 if(col<0||row<0||col>width-1||row>height-1)return null;
 const x=Math.floor(col),z=Math.floor(row),xx=Math.min(x+1,width-1),zz=Math.min(z+1,height-1),fx=col-x,fz=row-z;
 const values=[heights[z*width+x],heights[z*width+xx],heights[zz*width+x],heights[zz*width+xx]];
 if(!values.every(Number.isFinite))return null;
 return values[0]*(1-fx)*(1-fz)+values[1]*fx*(1-fz)+values[2]*(1-fx)*fz+values[3]*fx*fz;
}
