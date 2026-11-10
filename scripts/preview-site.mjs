import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=resolve(fileURLToPath(new URL('../dist',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.wasm':'application/wasm','.glb':'model/gltf-binary','.ktx2':'image/ktx2','.jpg':'image/jpeg','.png':'image/png','.txt':'text/plain; charset=utf-8'};
createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let path=resolve(root,'.'+pathname);
 if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 if((await stat(path)).isDirectory()){if(!pathname.endsWith('/')){res.writeHead(301,{Location:pathname+'/'}).end();return;}path=resolve(path,'index.html');}
 const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 }catch{res.writeHead(404).end('Not found');}}).listen(3410,'127.0.0.1',()=>console.log('http://127.0.0.1:3410/ — /laboratorio/pinguino/'));
