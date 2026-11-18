# Noticias

Editar noticias.json y ejecutar npm --prefix exploraciones/hero run build y node scripts/assemble-site.mjs desde la raíz.

- fecha: fecha de publicación verificada, formato YYYY-MM-DD.
- categoria: Ciencia, Campañas o Monitoreo. tema conserva la clasificación temática (Glaciología, Biodiversidad, etc.).
- url: artículo individual. estudioUrl: estudio enlazado, si existe; no se muestra como otro enlace en la card.
- imagen: archivo local, original, crédito, licencia y URL que documenta el permiso. Usar null cuando no se pueda verificar el permiso; se usa la imagen de respaldo.
- Las notas se ordenan por fecha descendente dentro de cada tema; los temas se ordenan por su nota más reciente.
- Abrir cada artículo antes de agregarlo, verificar fecha y contenido, escribir un resumen propio y evitar duplicados. Mantener hasta seis notas.

Revisión inicial: 18 de noviembre de 2026. Se consultaron los seis portales autorizados; se incluyeron cinco artículos verificables. Las fotografías de CONICET y CADIC se reutilizan bajo la licencia del pie de sus artículos (CC BY 2.5 AR); la de Armada, bajo los términos de Argentina.gob.ar (CC BY 4.0). Las otras dos notas conservan el respaldo al no haberse confirmado permiso para una fotografía. Los créditos y enlaces de licencia se muestran fuera de las cards, además del crédito breve en cada fotografía.
