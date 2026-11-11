/** Bounded local deformation adapted from Oguzhan Tufenk / Codrops (MIT).
 * See vendor/deformation/LICENSE.txt. Original vertex influence becomes an
 * elliptical stamp stored in a fixed field; overlaps cannot excavate deep holes. */
export class SnowFootprints {
 readonly depths:Float32Array;
 readonly cell:number;
 readonly ages:Float32Array;
 readonly initial:Float32Array;
 readonly active=new Set<number>();
 readonly holdSeconds=8;
 readonly fadeSeconds=6;
 constructor(public radius:number,public size=192,public maxDepth=.045){this.depths=new Float32Array(size*size);this.ages=new Float32Array(size*size);this.initial=new Float32Array(size*size);this.cell=radius*2/(size-1);}
 sample(x:number,z:number){
  const gx=Math.max(0,Math.min(this.size-1,(x+this.radius)/this.cell)),gz=Math.max(0,Math.min(this.size-1,(z+this.radius)/this.cell));
  const ix=Math.floor(gx),iz=Math.floor(gz),jx=Math.min(ix+1,this.size-1),jz=Math.min(iz+1,this.size-1),fx=gx-ix,fz=gz-iz;
  const a=this.depths[iz*this.size+ix]*(1-fx)+this.depths[iz*this.size+jx]*fx,b=this.depths[jz*this.size+ix]*(1-fx)+this.depths[jz*this.size+jx]*fx;
  return a*(1-fz)+b*fz;
 }
 stamp(x:number,z:number,yaw:number){
  const reach=.23,c=Math.cos(yaw),s=Math.sin(yaw),r=this.radius,n=this.size;
  const x0=Math.max(0,Math.floor((x-reach+r)/this.cell)),x1=Math.min(n-1,Math.ceil((x+reach+r)/this.cell));
  const z0=Math.max(0,Math.floor((z-reach+r)/this.cell)),z1=Math.min(n-1,Math.ceil((z+reach+r)/this.cell));
  let changed=false;
  for(let row=z0;row<=z1;row++)for(let col=x0;col<=x1;col++){
   const wx=col*this.cell-r,wz=row*this.cell-r;if(Math.hypot(wx,wz)>r-.05)continue;
   const dx=wx-x,dz=wz-z,lx=c*dx-s*dz,lz=s*dx+c*dz;
   // Broad toes and narrower heel suggest a penguin's webbed foot.
   const width=.105+.025*Math.max(-1,Math.min(1,lz/.17));
   const q=(lx/width)**2+(lz/.18)**2;if(q>=1)continue;
   const depth=this.maxDepth*(1-q)**2,index=row*n+col;
   this.ages[index]=0;this.initial[index]=Math.max(depth,this.depths[index]);this.active.add(index);
   if(depth>this.depths[index]+1e-7){this.depths[index]=depth;changed=true;}
  }
  return changed?{x0,x1,z0,z1,x,z,reach}:null;
 }
 /** Swept belly contact: one continuous capsule, independent of frame rate. */
 groove(ax:number,az:number,bx:number,bz:number){
  const width=.22,depthLimit=Math.min(this.maxDepth,.03),r=this.radius,n=this.size;
  const x0=Math.max(0,Math.floor((Math.min(ax,bx)-width+r)/this.cell)),x1=Math.min(n-1,Math.ceil((Math.max(ax,bx)+width+r)/this.cell));
  const z0=Math.max(0,Math.floor((Math.min(az,bz)-width+r)/this.cell)),z1=Math.min(n-1,Math.ceil((Math.max(az,bz)+width+r)/this.cell));
  const dx=bx-ax,dz=bz-az,length2=dx*dx+dz*dz;let changed=false;
  for(let row=z0;row<=z1;row++)for(let col=x0;col<=x1;col++){
   const x=col*this.cell-r,z=row*this.cell-r;if(Math.hypot(x,z)>r-.05)continue;
   const t=length2>0?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/length2)):0;
   const q=((x-ax-t*dx)**2+(z-az-t*dz)**2)/(width*width);if(q>=1)continue;
   const depth=depthLimit*(1-q)**2,i=row*n+col;
   this.ages[i]=0;this.initial[i]=Math.max(depth,this.depths[i]);this.active.add(i);
   if(depth>this.depths[i]+1e-7){this.depths[i]=depth;changed=true;}
  }
  return changed?{x0,x1,z0,z1}:null;
 }
 fade(dt:number){
  let x0=this.size,x1=-1,z0=this.size,z1=-1;
  for(const i of this.active){
   this.ages[i]+=Math.max(0,dt);const t=Math.min(1,Math.max(0,(this.ages[i]-this.holdSeconds)/this.fadeSeconds));
   const depth=this.initial[i]*(1-t*t*(3-2*t));
   if(depth!==this.depths[i]){this.depths[i]=depth;const x=i%this.size,z=Math.floor(i/this.size);x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}
   if(t===1){this.active.delete(i);this.initial[i]=0;this.ages[i]=0;}
  }
  return x1<0?null:{x0,x1,z0,z1};
 }
 clear(){this.depths.fill(0);this.ages.fill(0);this.initial.fill(0);this.active.clear();}
}
