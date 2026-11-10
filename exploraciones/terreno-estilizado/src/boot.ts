// Punto de entrada liviano. Verifica WebGL 2 y recién entonces descarga el visor 3D (Three.js, terreno,
// agua): sin WebGL no se bajan ~700 KB de código. Cuando el sitio tenga más páginas, solo la home importa
// "./main"; las páginas interiores quedan sin el peso del 3D.
const statusEl = document.getElementById("status");
if (!document.createElement("canvas").getContext("webgl2")) {
  if (statusEl) {
    statusEl.hidden = false;
    statusEl.textContent = "Este navegador no soporta WebGL 2.";
  }
} else {
  void import("./main");
}
