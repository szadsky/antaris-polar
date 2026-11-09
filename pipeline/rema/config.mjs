// Configuración del recorte REMA de caleta Potter.
// Todas las coordenadas de referencia provienen del SCAR Composite Gazetteer of Antarctica (CGA),
// consultado vía https://placenames.aq/api/place_names (fecha de consulta: 2026-11-08).

export const RETRIEVAL_DATE = '2026-11-08';

export const STAC = {
  root: 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/rema.json',
  base: 'https://pgc-opendata-dems.s3.us-west-2.amazonaws.com/rema/mosaics/v2.0',
  version: '2.0',
};

export const EPSG3031 =
  '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs';

// Puntos de referencia (lon, lat en WGS84). Fuente: SCAR CGA, name_id indicado.
export const REFERENCE_POINTS = [
  { key: 'carlini', name: 'Base Carlini (ex Jubany)', lon: -58.664444, lat: -62.237778, source: 'SCAR CGA name_id 136127 (USA), altitud publicada 10 m' },
  { key: 'potter_cove', name: 'Potter Cove / caleta Potter (punto GBR)', lon: -58.6845, lat: -62.233806, source: 'SCAR CGA name_id 110689 (GBR)' },
  { key: 'potter_cove_arg', name: 'Potter, caleta (punto ARG)', lon: -58.683333, lat: -62.233333, source: 'SCAR CGA name_id 101894 (ARG)' },
  { key: 'fourcade', name: 'Glaciar Fourcade (punto GBR)', lon: -58.665972, lat: -62.216, source: 'SCAR CGA name_id 135244 (GBR)' },
  { key: 'three_brothers_gbr', name: 'Three Brothers Hill / cerro Tres Hermanos (punto GBR)', lon: -58.674444, lat: -62.243111, source: 'SCAR CGA name_id 111576 (GBR): "rising to 195m"' },
  { key: 'three_brothers_usa', name: 'Three Brothers Hill (punto USA)', lon: -58.683333, lat: -62.25, source: 'SCAR CGA name_id 132669 (USA): altitud 210 m' },
  { key: 'mirounga_point', name: 'Mirounga Point (punta entrada E de la caleta)', lon: -58.677972, lat: -62.236972, source: 'SCAR CGA name_id 110172 (GBR)' },
  { key: 'barton_pen', name: 'Península Barton (punto GBR)', lon: -58.741278, lat: -62.226611, source: 'SCAR CGA name_id 107687 (GBR)' },
];

// Área de interés en EPSG:3031 (metros). Se fija en la proyección nativa de REMA para no
// remuestrear. Definida a partir de los puntos anteriores + margen; ver README.
// [xmin, ymin, xmax, ymax]
export const AOI_3031 = [-2631000, 1595500, -2623000, 1603500];

export const MAX_BYTES = 150 * 1024 * 1024; // límite del recorte float32 sin comprimir
export const RESOLUTIONS = [2, 10, 32];
