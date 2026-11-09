import { defineConfig } from "vite";

// Los terrenos ya procesados son los mismos de terreno-nitidez (alturas 4 m / 8 m,
// paso 0,5 m): se leen de ahí para no duplicar ~8,5 MB en el repositorio.
export default defineConfig({
  publicDir: "../terreno-nitidez/public",
  server: { port: 3400 },
});
