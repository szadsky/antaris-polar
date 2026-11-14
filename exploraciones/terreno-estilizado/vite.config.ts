import { defineConfig, type Plugin } from "vite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

// Solo en desarrollo: guarda el reflejo precalculado (seis JPEG) que captura bakeReflection (src/reflection-bake.ts).
// Acepta únicamente reflejo-<cara>.jpg dentro de la carpeta de una base existente.
const reflectionBake = (): Plugin => ({
  name: "reflection-bake",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/__bake-reflection", (req, res) => {
      const url = new URL(req.url ?? "", "http://x");
      const base = url.searchParams.get("base") ?? "", face = url.searchParams.get("face") ?? "";
      const dir = new URL(`../terreno-nitidez/public/terreno/${base}/`, import.meta.url);
      if (req.method !== "POST" || !/^[a-z0-9-]+$/.test(base) || !/^[pn][xyz]$/.test(face) || !existsSync(dir)) {
        res.statusCode = 400; res.end("pedido inválido"); return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => { writeFileSync(new URL(`reflejo-${face}.jpg`, dir), Buffer.concat(chunks)); res.end("ok"); });
    });
  },
});

// Los terrenos ya procesados son los mismos de terreno-nitidez (alturas 4 m / 8 m,
// paso 0,5 m): se leen de ahí para no duplicar ~8,5 MB en el repositorio.
export default defineConfig({
  publicDir: "../terreno-nitidez/public",
  server: { port: 3400 },
  assetsInclude: ["**/*.ktx2"],
  plugins: [basisTranscoder(), reflectionBake()],
  // Three.js en su propio archivo: cambia poco, así el navegador lo guarda en caché aparte del código del visor.
  build: { rollupOptions: { output: { manualChunks: (id) => (id.includes("node_modules/three/") ? "three" : undefined) } } },
});
