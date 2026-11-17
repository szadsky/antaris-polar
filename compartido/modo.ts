/**
 * Modo de la página: pública (sin controles) o exploración (con los paneles de parámetros).
 *
 * El sitio armado publica cada sección dos veces con el mismo código:
 *   /, /descubrir/, …                       → pública: sin paneles de ajustes ni atajos de prueba.
 *   /exploraciones-home/, -bases/, …        → exploración: con todos los controles (índice en /exploraciones/).
 *
 * Con controles: en desarrollo (npm run dev), bajo /exploraciones…, o con ?controles (o ?panel, el nombre anterior
 * del hero). Sin controles: el resto, o con ?publico (también en desarrollo, para ver la versión pública).
 * `aplicarModo()` deja la clase `sin-controles` en <html>: cada sitio oculta ahí lo que es de ajuste.
 */
export function conControles(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('publico')) return false;
  return import.meta.env.DEV || q.has('controles') || q.has('panel') || location.pathname.startsWith('/exploraciones');
}

export function aplicarModo(): boolean {
  const con = conControles();
  document.documentElement.classList.toggle('sin-controles', !con);
  return con;
}
