// Authored foot travel measured from penguin.glb at the lab height of 1.25 m.
export const GAIT_SPEED = {walk:.346,run:.84};
export const MOVE_SPEED = {walk:.48,run:1.1,slide:1.35};
/** Local character motion, in metres and seconds; independent of rendering and the DEM. */
export class PenguinMotion {
 x=0;z=0;y=0;verticalSpeed=0;yaw=0;moving=false;running=false;sliding=false;
 constructor(public limit:number){}
 reset(){this.x=this.z=this.y=this.verticalSpeed=this.yaw=0;this.moving=this.running=this.sliding=false;}
 jump(){if(this.y===0&&this.verticalSpeed===0)this.verticalSpeed=2.7;}
 step(dx:number,dz:number,run:boolean,dt:number,slide=false){
  dt=Math.max(0,Math.min(dt,.05));this.sliding=slide&&this.y===0&&this.verticalSpeed===0;if(this.sliding&&Math.hypot(dx,dz)===0){dx=Math.sin(this.yaw);dz=Math.cos(this.yaw);}const length=Math.hypot(dx,dz),speed=this.sliding?MOVE_SPEED.slide:run?MOVE_SPEED.run:MOVE_SPEED.walk;
  const px=this.x,pz=this.z;
  if(length>0){dx/=length;dz/=length;this.x+=dx*speed*dt;this.z+=dz*speed*dt;this.yaw=Math.atan2(dx,dz);}
  const distance=Math.hypot(this.x,this.z);if(distance>this.limit){this.x*=this.limit/distance;this.z*=this.limit/distance;}
  this.moving=Math.hypot(this.x-px,this.z-pz)>1e-6;this.running=this.moving&&run&&!this.sliding;
  if(this.y>0||this.verticalSpeed>0){this.y+=this.verticalSpeed*dt-5*dt*dt;this.verticalSpeed-=10*dt;if(this.y<=0){this.y=0;this.verticalSpeed=0;}}
 }
}
