// Generates the two menu-bar icons as base64 PNGs. Run once; output is inlined
// into src/trayIcons.ts so there are no binary assets in the repo.
const zlib = require('zlib');

const S = 36; // 18pt @2x
// A template image is reduced to its alpha channel and drawn small, so a thin
// ring washes out to nothing in the menu bar. Both variants are deliberately
// chunky; the filled one is smaller so the pair looks optically balanced.
const R = 12;
const R_FILLED = 9;
const STROKE = 4;

function crc32(buf) {
  let c,
    table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Coverage of a pixel by the shape, sampled 3x3 for antialiasing.
function coverage(x, y, filled) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3 - S / 2;
      const py = y + (sy + 0.5) / 3 - S / 2;
      const d = Math.hypot(px, py);
      if (filled ? d <= R_FILLED : Math.abs(d - R) <= STROKE / 2) hits++;
    }
  }
  return hits / 9;
}

function png(filled, luma) {
  const raw = Buffer.alloc(S * (S * 4 + 1));
  let p = 0;
  for (let y = 0; y < S; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < S; x++) {
      const a = Math.round(coverage(x, y, filled) * 255);
      // Black with alpha for macOS, which treats it as a template image and
      // recolours it for the current menu bar appearance. Nothing else does
      // that, so those platforms get the same shape drawn white — see the note
      // in src/trayIcons.ts.
      raw[p++] = luma;
      raw[p++] = luma;
      raw[p++] = luma;
      raw[p++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [suffix, luma] of [
  ['', 0],
  ['_LIGHT', 255],
]) {
  for (const [name, filled] of [
    ['IDLE', false],
    ['ACTIVE', true],
  ]) {
    console.log(`${name}${suffix}=` + png(filled, luma).toString('base64'));
  }
}
