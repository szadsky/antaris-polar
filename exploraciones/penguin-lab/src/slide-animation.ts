import {AnimationClip,PropertyBinding} from 'three';
/** Keep the swimming belly pose grounded; retain flipper/head/foot movement. */
export function groundedSlideClip(source:AnimationClip){
 const clip=source.clone();
 for(const track of clip.tracks){const target=PropertyBinding.parseTrackName(track.name);
  if(!['Hips','Spine','Chest'].includes(target.nodeName??''))continue;
  const stride=track.getValueSize();
  for(let i=stride;i<track.values.length;i++)track.values[i]=track.values[i%stride];
 }
 return clip;
}
