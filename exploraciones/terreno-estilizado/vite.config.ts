import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Transcodificador Basis de Three.js (para las texturas KTX2): en desarrollo se sirve desde
// node_modules; en el build se copia a basis/ junto a la página.
const require = createRequire(import.meta.url);
const basisDir = require.resolve("three/examples/jsm/libs/basis/basis_transcoder.js").replace(/basis_transcoder\.js$/, "");
const basisTranscoder = (): Plugin => ({
  name: "basis-transcoder",
  apply: "build",
  generateBundle() {
    for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
      this.emitFile({ type: "asset", fileName: `basis/${f}`, source: readFileSync(basisDir + f) });
    }
  },
});

// Los terrenos ya procesados son los mismos de terreno-nitidez (alturas 4 m / 8 m,
// paso 0,5 m): se leen de ahí para no duplicar ~8,5 MB en el repositorio.
export default defineConfig({
  publicDir: "../terreno-nitidez/public",
  server: { port: 3400 },
  assetsInclude: ["**/*.ktx2"],
  plugins: [basisTranscoder()],
  // Three.js en su propio archivo: cambia poco, así el navegador lo guarda en caché aparte del código del visor.
  build: { rollupOptions: { output: { manualChunks: (id) => (id.includes("node_modules/three/") ? "three" : undefined) } } },
});
