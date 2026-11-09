// Codificador PNG mínimo (escala de grises 8 o 16 bits) usando solo node:zlib.
import { deflateSync, crc32 } from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * @param {Uint8Array|Uint16Array} pixels width*height
 * @param {number} width
 * @param {number} height
 * @param {8|16} bitDepth
 * @param {Record<string,string>} [text] chunks tEXt (latin1)
 */
export function encodeGrayPng(pixels, width, height, bitDepth, text = {}) {
  const bpp = bitDepth / 8;
  const raw = Buffer.alloc(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * bpp);
    raw[o] = 0; // filtro None
    for (let x = 0; x < width; x++) {
      const v = pixels[y * width + x];
      if (bitDepth === 16) raw.writeUInt16BE(v, o + 1 + x * 2);
      else raw[o + 1 + x] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = 0; // escala de grises
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const texts = Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...texts,
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
