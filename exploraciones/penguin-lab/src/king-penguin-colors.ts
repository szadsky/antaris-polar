import * as THREE from 'three';

/** Rest-pose vertex colours: the existing skin carries the markings through every animation. */
export function applyKingPenguinColors(root: THREE.Object3D) {
 const white=new THREE.Color('#f5f4ee'),gold=new THREE.Color('#ffc34c');
 const black=new THREE.Color('#202630'),back=new THREE.Color('#53606b'),feet=new THREE.Color('#45434a'),bill=new THREE.Color('#eaa04d');
 const color=new THREE.Color();
 const smooth=THREE.MathUtils.smoothstep;
 root.traverse(object=>{
  if(!(object instanceof THREE.Mesh))return;
  const geometry=object.geometry,positions=geometry.getAttribute('position'),original=geometry.getAttribute('color');
  if(!positions||!original)return;
  const colors=original.clone();
  for(let i=0;i<positions.count;i++){
   const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
   const r=original.getX(i),g=original.getY(i),b=original.getZ(i);
   color.setRGB(r,g,b);
   const light=r>.8&&g>.8&&b>.8;
   const plumage=light||(r>.05&&r<.08&&Math.abs(r-g)<.01);
   if(plumage){
    if(light){
     color.copy(white);
     // Broad, continuous golden upper breast fading to ivory down the belly.
     const breast=smooth(y,.34,.55)*smooth(z,.005,.09);
     color.lerp(gold,breast*.92);
     color.lerp(black,smooth(y,.535,.605));
    }else{
     color.copy(back).lerp(black,smooth(y,.48,.60));
    }
   }else if(r>g*2&&g>b*2&&r>.5){
    if(y<.2)color.copy(feet);
    else{color.copy(black);const stripe=(1-smooth(y,.635,.651))*smooth(z,.155,.205);color.lerp(bill,stripe);}
   }else if(r>.5&&r<.7&&Math.abs(r-g)<.02)color.copy(back);
   colors.setXYZ(i,color.r,color.g,color.b);
  }
  geometry.setAttribute('color',colors);
  // Evaluate the marking per fragment in the rest pose, before skinning.
  // This gives a continuous edge independent of mesh tessellation.
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof THREE.MeshStandardMaterial))continue;
   material.onBeforeCompile=shader=>{
    shader.uniforms.kingOrange={value:new THREE.Color('#f3a229')};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 kingRestPosition;');
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nkingRestPosition = position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 kingRestPosition;\nuniform vec3 kingOrange;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      // Auricular patch: rounded upper lobe and a narrow curved lower tip.
      float kingT = clamp((kingRestPosition.y - 0.550) / 0.100, 0.0, 1.0);
      float kingLower = smoothstep(0.0, 0.65, kingT);
      float kingUpper = sqrt(max(0.0, 1.0 - pow(max(kingT - 0.65, 0.0) / 0.35, 2.0)));
      float kingRadius = 0.026 * kingLower * kingUpper;
      float kingCenter = 0.040 + 0.060 * pow(1.0 - kingT, 3.0);
      float kingDistance = max(abs(kingRestPosition.z - kingCenter) - kingRadius,
        max(0.550 - kingRestPosition.y, kingRestPosition.y - 0.650));
      float kingAA = max(fwidth(kingDistance) * 0.5, 0.00001);
      float kingMask = 1.0 - smoothstep(-kingAA, kingAA, kingDistance);
      kingMask *= smoothstep(0.045, 0.060, abs(kingRestPosition.x));
      diffuseColor.rgb = mix(diffuseColor.rgb, kingOrange, kingMask);
    `);
   };
   material.customProgramCacheKey=()=> 'king-penguin-neck-v2';
   material.needsUpdate=true;
  }
 });
}
