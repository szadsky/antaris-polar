// Escritor mínimo de GeoTIFF (TIFF clásico, little-endian) para un raster de una banda (float32 o uint8).
// - Compresión DEFLATE (código 8), por tiras (strips); predictor de punto flotante (3) para float32.
// - GeoKeys: modelo proyectado, PixelIsArea, EPSG proyectado configurable.
// - Etiqueta GDAL_NODATA (42113).
// Se usa en lugar de geotiff.js#writeArrayBuffer porque éste no comprime ni escribe GDAL_NODATA.
// La salida se verifica leyéndola de nuevo con geotiff.js (ver fetch-potter-cove.mjs).

import { deflateSync } from 'node:zlib';

const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, DOUBLE: 12 };
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8 };

/** Predictor 3 (TIFF Tech Note 3): reordena bytes en planos (MSB primero) y diferencia horizontalmente. */
function encodeRowFloatPredictor(rowF32, width) {
  const src = new Uint8Array(rowF32.buffer, rowF32.byteOffset, width * 4);
  const out = new Uint8Array(width * 4);
  // plano 0 = byte más significativo (en little-endian es el byte 3)
  for (let i = 0; i < width; i++) {
    out[i] = src[i * 4 + 3];
    out[width + i] = src[i * 4 + 2];
    out[2 * width + i] = src[i * 4 + 1];
    out[3 * width + i] = src[i * 4 + 0];
  }
  for (let i = out.length - 1; i > 0; i--) out[i] = (out[i] - out[i - 1]) & 0xff;
  return out;
}

/**
 * @param {Float32Array|Uint8Array} data  width*height, fila por fila, de norte a sur
 * @param {object} o { width, height, originX, originY, pixelSize, epsg, nodata, rowsPerStrip?, citation?, description? }
 * @returns {Buffer}
 */
export function writeFloat32GeoTiff(data, o) {
  return writeGeoTiff(data, { ...o, dtype: 'float32' });
}

export function writeUint8GeoTiff(data, o) {
  return writeGeoTiff(data, { ...o, dtype: 'uint8' });
}

function writeGeoTiff(data, o) {
  const { width, height, originX, originY, pixelSize, epsg, nodata } = o;
  const isFloat = o.dtype === 'float32';
  const bps = isFloat ? 4 : 1;
  const rowsPerStrip = o.rowsPerStrip ?? 16;
  const nStrips = Math.ceil(height / rowsPerStrip);

  // 1) comprimir tiras
  const strips = [];
  for (let s = 0; s < nStrips; s++) {
    const r0 = s * rowsPerStrip;
    const r1 = Math.min(height, r0 + rowsPerStrip);
    let raw;
    if (isFloat) {
      raw = new Uint8Array((r1 - r0) * width * 4);
      for (let r = r0; r < r1; r++) {
        raw.set(encodeRowFloatPredictor(data.subarray(r * width, (r + 1) * width), width), (r - r0) * width * 4);
      }
    } else {
      raw = data.subarray(r0 * width, r1 * width);
    }
    strips.push(deflateSync(raw, { level: 9 }));
  }

  // 2) GeoKeyDirectory
  const citation = (o.citation ?? `EPSG:${epsg}`) + '|';
  const geoKeys = [
    [1024, 0, 1, 1], // GTModelTypeGeoKey = ModelTypeProjected
    [1025, 0, 1, 1], // GTRasterTypeGeoKey = RasterPixelIsArea
    [1026, 34737, citation.length, 0], // GTCitationGeoKey -> GeoAsciiParams
    [3072, 0, 1, epsg], // ProjectedCSTypeGeoKey
    [3076, 0, 1, 9001], // ProjLinearUnitsGeoKey = metre
  ];
  const geoKeyDir = [1, 1, 0, geoKeys.length, ...geoKeys.flat()];

  const tags = [
    [256, T.LONG, [width]], // ImageWidth
    [257, T.LONG, [height]], // ImageLength
    [258, T.SHORT, [bps * 8]], // BitsPerSample
    [259, T.SHORT, [8]], // Compression = Adobe Deflate
    [262, T.SHORT, [1]], // Photometric = BlackIsZero
    ...(o.description ? [[270, T.ASCII, o.description]] : []), // ImageDescription
    [273, T.LONG, new Array(nStrips).fill(0)], // StripOffsets (se completan luego)
    [277, T.SHORT, [1]], // SamplesPerPixel
    [278, T.LONG, [rowsPerStrip]], // RowsPerStrip
    [279, T.LONG, strips.map((s) => s.length)], // StripByteCounts
    [284, T.SHORT, [1]], // PlanarConfiguration
    [305, T.ASCII, 'antaris-polar pipeline/rema (Node)'], // Software
    [317, T.SHORT, [isFloat ? 3 : 1]], // Predictor (3 = punto flotante, 1 = ninguno)
    [339, T.SHORT, [isFloat ? 3 : 1]], // SampleFormat (3 = IEEE float, 1 = uint)
    [33550, T.DOUBLE, [pixelSize, pixelSize, 0]], // ModelPixelScale
    [33922, T.DOUBLE, [0, 0, 0, originX, originY, 0]], // ModelTiepoint
    [34735, T.SHORT, geoKeyDir], // GeoKeyDirectory
    [34737, T.ASCII, citation], // GeoAsciiParams
    [42113, T.ASCII, String(nodata)], // GDAL_NODATA
  ].sort((a, b) => a[0] - b[0]);

  const valueBytes = (type, v) => (type === T.ASCII ? Buffer.byteLength(v, 'latin1') + 1 : v.length * TYPE_SIZE[type]);
  const count = (type, v) => (type === T.ASCII ? Buffer.byteLength(v, 'latin1') + 1 : v.length);

  // 3) layout: header(8) | IFD | valores largos | tiras
  const ifdSize = 2 + tags.length * 12 + 4;
  let cursor = 8 + ifdSize;
  const extOffsets = new Map();
  for (const [tag, type, v] of tags) {
    const n = valueBytes(type, v);
    if (n > 4) {
      if (cursor % 2) cursor++;
      extOffsets.set(tag, cursor);
      cursor += n;
    }
  }
  if (cursor % 2) cursor++;
  const stripOffsets = [];
  for (const s of strips) {
    stripOffsets.push(cursor);
    cursor += s.length;
  }
  tags.find((t) => t[0] === 273)[2] = stripOffsets;
  if (stripOffsets.length * 4 > 4 && !extOffsets.has(273)) throw new Error('layout');

  const buf = Buffer.alloc(cursor);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(tags.length, 8);

  const writeValues = (off, type, v) => {
    if (type === T.ASCII) {
      buf.write(v + '\0', off, 'latin1');
      return;
    }
    v.forEach((x, i) => {
      if (type === T.SHORT) buf.writeUInt16LE(x, off + i * 2);
      else if (type === T.LONG) buf.writeUInt32LE(x, off + i * 4);
      else if (type === T.DOUBLE) buf.writeDoubleLE(x, off + i * 8);
      else if (type === T.BYTE) buf.writeUInt8(x, off + i);
    });
  };

  tags.forEach(([tag, type, v], i) => {
    const e = 10 + i * 12;
    buf.writeUInt16LE(tag, e);
    buf.writeUInt16LE(type, e + 2);
    buf.writeUInt32LE(count(type, v), e + 4);
    if (extOffsets.has(tag)) {
      buf.writeUInt32LE(extOffsets.get(tag), e + 8);
      writeValues(extOffsets.get(tag), type, v);
    } else {
      writeValues(e + 8, type, v);
    }
  });
  buf.writeUInt32LE(0, 10 + tags.length * 12); // no hay más IFDs
  strips.forEach((s, i) => s.copy ? s.copy(buf, stripOffsets[i]) : buf.set(s, stripOffsets[i]));
  return buf;
}
