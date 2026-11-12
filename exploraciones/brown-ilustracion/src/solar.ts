import SunCalc from "suncalc";
import * as THREE from "three";

// EPSG:3031 has central meridian 0°. Scene +Z follows decreasing projected northing.
export function solarPosition(instant: Date, lat: number, lon: number) {
  const { altitude, azimuth } = SunCalc.getPosition(instant, lat, lon);
  const bearing = azimuth + Math.PI;
  const gridBearing = bearing + THREE.MathUtils.degToRad(lon);
  const direction = new THREE.Vector3(Math.cos(altitude)*Math.sin(gridBearing),
    Math.sin(altitude), -Math.cos(altitude)*Math.cos(gridBearing));
  return {direction, altitude, bearing};
}
