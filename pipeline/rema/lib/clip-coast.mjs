/**
 * Recorta polígonos Esri JSON (EPSG:3031) a un rectángulo.
 *
 * El servicio del ADD devuelve el polígono completo que intersecta el recuadro:
 * si una base toca el continente, llega la Antártida entera (~3 M vértices, ~83 MB).
 * Recortar cada anillo con Sutherland–Hodgman conserva exactamente la región
 * dentro del rectángulo, que es lo único que usa la máscara mar/tierra.
 */
export function clipEsriPolygons(esri, [xmin, ymin, xmax, ymax]) {
  const features = [];
  for (const f of esri.features) {
    const rings = [];
    for (const ring of f.geometry.rings) {
      const c = clipRing(ring, xmin, ymin, xmax, ymax);
      if (c.length >= 4) rings.push(c);
    }
    if (rings.length) features.push({ attributes: f.attributes, geometry: { rings } });
  }
  return { ...esri, features, clippedTo: [xmin, ymin, xmax, ymax] };
}

function clipRing(ring, xmin, ymin, xmax, ymax) {
  let pts = ring;
  const edges = [
    [(p) => p[0] >= xmin, (a, b) => lerpAt(a, b, 0, xmin)],
    [(p) => p[0] <= xmax, (a, b) => lerpAt(a, b, 0, xmax)],
    [(p) => p[1] >= ymin, (a, b) => lerpAt(a, b, 1, ymin)],
    [(p) => p[1] <= ymax, (a, b) => lerpAt(a, b, 1, ymax)],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    pts = out;
  }
  if (pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) pts.push(pts[0]);
  return pts;
}

function lerpAt(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return axis === 0 ? [v, a[1] + t * (b[1] - a[1])] : [a[0] + t * (b[0] - a[0]), v];
}
