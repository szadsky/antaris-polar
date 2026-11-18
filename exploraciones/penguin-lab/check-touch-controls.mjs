import assert from 'node:assert/strict';
import {setupTouchControls} from './src/touch-controls.ts';
class Element extends EventTarget {
 style={removeProperty(){}};classList={add(){},remove(){}};children=[];
 setAttribute(){} setPointerCapture(){} append(x){this.children.push(x);}
 getBoundingClientRect(){return {left:0,top:0,width:160,height:140};}
 querySelector(s){return this.nodes[s]??=new Element();}nodes={};
}
globalThis.document=Object.assign(new EventTarget(),{body:new Element(),createElement:()=>new Element()});
globalThis.window=new EventTarget();globalThis.matchMedia=()=>({matches:true});
const snapshots=[];let jumps=0;
const touch=setupTouchControls({floating:false,onInput:v=>snapshots.push({...v}),onJump:()=>jumps++,onFirstTouch(){}});
const stick=touch.root.querySelector('.touch-stick');
function pointer(node,type,x,y){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,clientX:x,clientY:y});node.dispatchEvent(e);}
pointer(stick,'pointerdown',125,70);assert(touch.input.x>.7,'Touching the edge must move without requiring a drag');
pointer(stick,'pointermove',80,14);assert.equal(touch.input.z,1);assert.equal(touch.input.run,true);
pointer(stick,'lostpointercapture',80,14);assert.equal(touch.input.x,0);assert.equal(touch.input.z,0);
pointer(stick,'pointerdown',80,70);assert.equal(touch.input.z,0);
pointer(stick,'pointermove',24,70);assert.equal(touch.input.x,-1);
pointer(stick,'pointercancel',24,70);assert.equal(touch.input.x,0);
pointer(touch.root.querySelector('.touch-btn--jump'),'pointerdown',0,0);assert.equal(jumps,1);
pointer(touch.root.querySelector('.touch-btn--slide'),'pointerdown',0,0);assert(touch.input.slide);touch.release();assert(!touch.input.slide);
assert(snapshots.some(s=>s.x>0));assert.equal(snapshots.at(-1).z,0);
console.log('PASS: fixed joystick, immediate input, drag, capture loss, cancel, jump and release.');
