/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Generates PNG and ICO icon assets for Tauri Windows builds
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPngBuffer(width: number, height: number): Buffer {
  // Signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // 8-bit depth
  ihdrData.writeUInt8(6, 9); // RGBA
  ihdrData.writeUInt8(0, 10); // Compression
  ihdrData.writeUInt8(0, 11); // Filter
  ihdrData.writeUInt8(0, 12); // Interlace
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Generate image data: Cyan/Dark gradient with "N" shape
  const scanlines: Buffer[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.45;

  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(1 + width * 4);
    line[0] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const idx = 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= r) {
        // Deep cyan gradient with rounded border
        const t = y / height;
        const red = Math.floor(6 + t * 14);
        const green = Math.floor(182 - t * 40);
        const blue = Math.floor(212 - t * 20);
        line[idx] = red;
        line[idx + 1] = green;
        line[idx + 2] = blue;
        line[idx + 3] = 255;
      } else {
        line[idx] = 0;
        line[idx + 1] = 0;
        line[idx + 2] = 0;
        line[idx + 3] = 0; // Transparent
      }
    }
    scanlines.push(line);
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcVal]);
}

function createIcoBuffer(png32: Buffer, png128: Buffer): Buffer {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = Icon
  header.writeUInt16LE(2, 4); // 2 images (32x32, 128x128)

  // Directory entry for 32x32: 16 bytes
  const entry32 = Buffer.alloc(16);
  entry32.writeUInt8(32, 0); // Width
  entry32.writeUInt8(32, 1); // Height
  entry32.writeUInt8(0, 2); // Colors
  entry32.writeUInt8(0, 3); // Reserved
  entry32.writeUInt16LE(1, 4); // Planes
  entry32.writeUInt16LE(32, 6); // Bits per pixel
  entry32.writeUInt32LE(png32.length, 8); // Size in bytes
  entry32.writeUInt32LE(6 + 16 + 16, 12); // Offset = 38

  // Directory entry for 128x128: 16 bytes
  const entry128 = Buffer.alloc(16);
  entry128.writeUInt8(128, 0); // Width
  entry128.writeUInt8(128, 1); // Height
  entry128.writeUInt8(0, 2); // Colors
  entry128.writeUInt8(0, 3); // Reserved
  entry128.writeUInt16LE(1, 4); // Planes
  entry128.writeUInt16LE(32, 6); // Bits per pixel
  entry128.writeUInt32LE(png128.length, 8); // Size in bytes
  entry128.writeUInt32LE(6 + 16 + 16 + png32.length, 12); // Offset

  return Buffer.concat([header, entry32, entry128, png32, png128]);
}

const iconsDir = path.resolve('src-tauri/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('Generating Tauri Icon Assets in:', iconsDir);
const png32 = createPngBuffer(32, 32);
const png128 = createPngBuffer(128, 128);
const png256 = createPngBuffer(256, 256);
const ico = createIcoBuffer(png32, png128);

fs.writeFileSync(path.join(iconsDir, '32x32.png'), png32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), png128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), png256);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), png256);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(iconsDir, 'Square30x30Logo.png'), createPngBuffer(30, 30));
fs.writeFileSync(path.join(iconsDir, 'Square44x44Logo.png'), createPngBuffer(44, 44));
fs.writeFileSync(path.join(iconsDir, 'Square71x71Logo.png'), createPngBuffer(71, 71));
fs.writeFileSync(path.join(iconsDir, 'Square89x89Logo.png'), createPngBuffer(89, 89));
fs.writeFileSync(path.join(iconsDir, 'Square107x107Logo.png'), createPngBuffer(107, 107));
fs.writeFileSync(path.join(iconsDir, 'Square142x142Logo.png'), createPngBuffer(142, 142));
fs.writeFileSync(path.join(iconsDir, 'Square150x150Logo.png'), createPngBuffer(150, 150));
fs.writeFileSync(path.join(iconsDir, 'Square284x284Logo.png'), createPngBuffer(284, 284));
fs.writeFileSync(path.join(iconsDir, 'Square310x310Logo.png'), createPngBuffer(310, 310));
fs.writeFileSync(path.join(iconsDir, 'StoreLogo.png'), createPngBuffer(50, 50));

console.log('All Tauri icon assets generated successfully.');
