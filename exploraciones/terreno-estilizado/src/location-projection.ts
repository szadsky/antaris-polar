/** WGS84 Antarctic Polar Stereographic (EPSG:3031), metres.
 * Same Snyder formula as terreno-bases/scripts/build-map.mjs (ADD preparation).
 * True-scale latitude -71°, central meridian 0°. SVG Y inversion is done by the caller.
 */
export function projectLocation(lat: number, lon: number): [number, number] {
  const a = 6378137, e = 0.0818191908426215;
  const t = (phi: number) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi))) ** (e / 2);
  const standard = 71 * Math.PI / 180;
  const m = Math.cos(standard) / Math.sqrt(1 - e * e * Math.sin(standard) ** 2);
  const rho = a * m * t(-lat * Math.PI / 180) / t(standard);
  const lambda = lon * Math.PI / 180;
  return [rho * Math.sin(lambda), rho * Math.cos(lambda)];
}
