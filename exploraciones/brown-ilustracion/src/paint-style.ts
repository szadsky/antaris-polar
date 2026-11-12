import * as THREE from 'three';
const color=(hex:string)=>{const c=new THREE.Color(hex);return new THREE.Vector3(c.r,c.g,c.b);};
export const paintUniforms=()=>({
 uPaint:{value:1},uPaintArt:{value:1},uPaintBrush:{value:.55},
 uPaintIvory:{value:color('#eee9dc')},uPaintShade:{value:color('#a5b8d1')},
 uPaintRockDark:{value:color('#68738b')},uPaintRockLight:{value:color('#c3b59e')}
});
export const PAINT_PARS=`
uniform float uPaint, uPaintBrush, uPaintArt;
uniform vec3 uPaintIvory,uPaintShade,uPaintRockDark,uPaintRockLight;
`;
// Existing seamless noise, sampled in world space: no extra texture, no displacement.
export const PAINT_COLOR=`
// Quantise shading direction softly, not positions: broad painted rock planes.
vec3 paintRockNormal=n;
vec3 paintIce=uIce;
float paintRough=.96;
if(uPaint > 0.001){
 vec3 q=n*5.0;
 paintRockNormal=normalize(floor(q)+smoothstep(vec3(.46),vec3(.54),fract(q)));
 float wash=triNoise(vWorld,n,1.0/220.0).r;
 float stroke=triNoise(mix(vWorld*vec3(0.75,3.5,0.75),vWorld,uPaintArt),n,1.0/70.0).g;
 float pigment=smoothstep(0.18,0.83,wash*0.85+stroke*0.15);
 float facing=0.7;
 #if NUM_DIR_LIGHTS > 0
 vec3 paintSun=inverseTransformDirection(directionalLights[0].direction,viewMatrix);
 facing=dot(paintRockNormal,paintSun);
 #endif
 float edgeWidth=max(.10,fwidth(facing));
 float planeLight=smoothstep(.14-edgeWidth,.14+edgeWidth,facing)*.65+smoothstep(.62-edgeWidth,.62+edgeWidth,facing)*.35;
 vec3 paintedRock=mix(uPaintRockDark,uPaintRockLight,planeLight*.82+pigment*.18);
 paintedRock*=1.0+(smoothstep(.22,.78,stroke)-.5)*.24*uPaintBrush;
 float shade=1.0-smoothstep(-.12,.72,facing);
 vec3 paintedSnow=mix(uPaintIvory,uPaintShade,shade*.38);
 paintedSnow*=1.0+(stroke-.5)*.035*uPaintBrush;

 if(uPaintArt>.5){
  // Hand-painted planes, using the existing world-space triplanar pigment reads.
  float patches=smoothstep(.25,.75,wash);
  float brush=smoothstep(.32,.66,stroke);
  vec3 slateShadow=vec3(.045,.080,.155),slateLight=vec3(.32,.40,.48);
  paintedRock=mix(slateShadow,slateLight,planeLight*.78+patches*.22);
  paintedRock=mix(paintedRock,paintedRock*vec3(.83,1.04,1.12),patches*.22);
  paintedRock*=1.0+(brush-.5)*.32*uPaintBrush;
  // Curvature and cavity already come from REMA; no silhouette extrusion or screen outline.
  float ridge=(1.0-smoothstep(.30,.49,lgt.b))*(1.0-step(.5,float(closureFace)));
  float edge=ridge*smoothstep(.12,.75,facing);
  paintedRock=mix(paintedRock,vec3(.49,.61,.66),edge*.20);
  paintedRock*=mix(.70,1.0,smoothstep(.48,.98,cav));
  vec3 ivory=vec3(.88,.86,.77),blueSnow=vec3(.36,.55,.74);
  paintedSnow=mix(ivory,blueSnow,shade*.57+(1.0-cav)*.22);
  paintedSnow=mix(paintedSnow,paintedSnow*vec3(.91,1.01,1.055),patches*.24);
  paintedSnow*=1.0+(brush-.5)*.075*uPaintBrush;
  paintedSnow=mix(paintedSnow,vec3(.88,.95,.96),edge*.10);
  paintIce=mix(vec3(.12,.34,.48),vec3(.48,.75,.83),planeLight*.75+patches*.25);
  paintRough=mix(.94,.86,rockT)+(brush-.5)*.04;
  // Broad pigment relief rather than photorealistic cracks. No texture allocations.
  vec3 dx=dFdx(vWorld),dy=dFdy(vWorld),rx=cross(dy,n),ry=cross(n,dx);
  float det=dot(dx,rx),height=(brush-.5)*.9*uPaintBrush;
  vec3 grad=(rx*dFdx(height)+ry*dFdy(height))/max(abs(det),.00001)*sign(det);
  paintRockNormal=normalize(mix(n,paintRockNormal,.30)-grad*.20);
 }
 rock=mix(rock,paintedRock,uPaint);
 snow=mix(snow,paintedSnow,uPaint);
}
`;
