import { defineConfig } from "vite";
import { resolve } from "node:path";

// Dos vistas independientes: terreno 3D (index) y mapa de bases.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        terreno: resolve(__dirname, "index.html"),
        bases: resolve(__dirname, "bases.html"),
      },
    },
  },
});
