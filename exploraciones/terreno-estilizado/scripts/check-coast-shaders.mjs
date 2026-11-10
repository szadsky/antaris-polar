import {build} from 'esbuild';import assert from 'node:assert/strict';
const {outputFiles}=await build({stdin:{contents:'export {stylizedMaterial,baseMaterial} from "./src/shaders.ts"; export {ShaderLib} from "three";',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',define:{'import.meta.env.DEV':'false'},plugins:[{name:'asset-urls',setup(b){b.onResolve({filter:/\.ktx2\?url$/},a=>({path:a.path,namespace:'asset'}));b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default "test.ktx2"',loader:'js'}));}}]});
const {stylizedMaterial,baseMaterial,ShaderLib}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].contents).toString('base64'));
for(const grid of [undefined,{}])for(const variant of ['a','b','c','n','base']){
 const m=variant==='base'?baseMaterial({},{grid,exactCoast:true}):stylizedMaterial({},{grid,variant,exactCoast:true});
 const s={vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader,uniforms:{}};m.onBeforeCompile(s,{});
 for(const key of ['vertexShader','fragmentShader'])assert.equal((s[key].match(/varying vec3 vClosureNormal;/g)||[]).length,1,key+' '+variant);
 assert(!s.fragmentShader.includes('abs(faceN.y)'));assert(s.vertexShader.includes('vClosureNormal ='));m.dispose();
}
console.log('10 variantes de shader: identificación costera coherente y declaración compartida correcta. No sustituye validación GPU.');
