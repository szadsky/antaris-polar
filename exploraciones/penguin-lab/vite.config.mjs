export default ({command})=>({base:command==='build'?'/laboratorio/pinguino/':'/',server:{port:3402,host:'127.0.0.1',strictPort:true},cacheDir:'.vite',assetsInclude:['**/*.ktx2']});
