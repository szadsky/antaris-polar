import {fileURLToPath} from 'node:url';
// Dos páginas comparten código y recursos (/laboratorio/pinguino/assets/): el laboratorio original (index.html)
// y Pingüino · menú con las islas de práctica (pinguino-menu/index.html, publicada en /pinguino-menu/).
const page=path=>fileURLToPath(new URL(path,import.meta.url));
export default ({command})=>({base:command==='build'?'/laboratorio/pinguino/':'/',server:{port:3402,host:'127.0.0.1',strictPort:true,fs:{allow:[page('./'),page('../../compartido')]}},cacheDir:'.vite',assetsInclude:['**/*.ktx2'],
 build:{rollupOptions:{input:{laboratorio:page('./index.html'),menu:page('./pinguino-menu/index.html')}}}});
