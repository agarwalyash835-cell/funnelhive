// Generates build/icon.ico (multi-resolution) and build/icon.png from a simple
// solid-color design. Pure Node, no native deps. Run once via `npm run icon`.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "build");
fs.mkdirSync(OUT_DIR, { recursive: true });

// Minimal PNG encoder (RGBA, no filtering) — sufficient for an app icon.
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(size, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // Add filter byte (0) per scanline
  const rowLen = size * 4;
  const raw = Buffer.alloc((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0;
    pixels.copy(raw, y * (rowLen + 1) + 1, y * rowLen, y * rowLen + rowLen);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Brand-ish gradient: deep indigo background, white "T" mark.
function renderPixels(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Gradient indigo -> violet
      const t = y / size;
      const r = Math.round(28 + t * 16);
      const g = Math.round(25 + t * 14);
      const b = Math.round(23 + t * 12);
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  // Draw a white "T" in the center: horizontal bar + vertical stem
  const barTop = Math.round(size * 0.28);
  const barBottom = Math.round(size * 0.4);
  const barLeft = Math.round(size * 0.22);
  const barRight = Math.round(size * 0.78);
  const stemLeft = Math.round(size * 0.44);
  const stemRight = Math.round(size * 0.56);
  const stemBottom = Math.round(size * 0.78);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inBar = y >= barTop && y <= barBottom && x >= barLeft && x <= barRight;
      const inStem = y >= barTop && y <= stemBottom && x >= stemLeft && x <= stemRight;
      if (inBar || inStem) {
        const i = (y * size + x) * 4;
        px[i] = 245;
        px[i + 1] = 158;
        px[i + 2] = 11;
        px[i + 3] = 255;
      }
    }
  }
  return px;
}

// ICO entries — Windows uses these sizes; 256 is the largest legal value.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
// Standalone PNG must be ≥512 to satisfy electron-builder's icon validator
// (used for Linux/macOS and as a fallback source).
const PNG_SIZE = 512;

// Build ICO entries
const pngs = ICO_SIZES.map((s) => ({ size: s, data: makePng(s, renderPixels(s)) }));

// Write a 512x512 standalone PNG for non-Windows targets and validators.
fs.writeFileSync(path.join(OUT_DIR, "icon.png"), makePng(PNG_SIZE, renderPixels(PNG_SIZE)));

// Build an .ICO that contains PNG-compressed entries (Vista+ supports this).
// ICO header: 6 bytes; directory entry: 16 bytes per image.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = [];
const blobs = [];
for (const { size, data } of pngs) {
  const e = Buffer.alloc(16);
  e[0] = size >= 256 ? 0 : size; // width (0 means 256)
  e[1] = size >= 256 ? 0 : size; // height
  e[2] = 0; // palette
  e[3] = 0; // reserved
  e.writeUInt16LE(1, 4); // color planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  blobs.push(data);
  offset += data.length;
}

const ico = Buffer.concat([header, ...entries, ...blobs]);
fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), ico);

console.log("Wrote", path.join(OUT_DIR, "icon.ico"), "and icon.png");
