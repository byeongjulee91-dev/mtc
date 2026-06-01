// Generate a 1024x1024 source PNG for `tauri icon` — no image deps.
// A dark rounded square with an orange terminal prompt glyph ">_".
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 1024;
const buf = Buffer.alloc(S * S * 4);

const bg = [0x16, 0x1a, 0x22, 0xff]; // dark slate
const fg = [0xd9, 0x77, 0x57, 0xff]; // claude orange
const transparent = [0, 0, 0, 0];

function set(x, y, c) {
  const i = (y * S + x) * 4;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
  buf[i + 3] = c[3];
}

// rounded-rect background
const r = 180;
function inRounded(x, y) {
  const m = 40;
  const x0 = m, y0 = m, x1 = S - m, y1 = S - m;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2 || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    set(x, y, inRounded(x, y) ? bg : transparent);
  }
}

// thick ">" chevron
function stroke(ax, ay, bx, by, w) {
  const steps = Math.ceil(Math.hypot(bx - ax, by - ay));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    for (let dy = -w; dy <= w; dy++)
      for (let dx = -w; dx <= w; dx++)
        if (dx * dx + dy * dy <= w * w) {
          const x = Math.round(px + dx), y = Math.round(py + dy);
          if (x >= 0 && x < S && y >= 0 && y < S && inRounded(x, y)) set(x, y, fg);
        }
  }
}
stroke(360, 360, 540, 512, 34); // upper arm
stroke(540, 512, 360, 664, 34); // lower arm
// underscore "_"
stroke(600, 690, 740, 690, 30);

// PNG encode (filter 0 per scanline)
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  buf.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const idat = deflateSync(raw, { level: 9 });

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(b) {
  let c = ~0;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(new URL('../app-icon.png', import.meta.url), png);
console.log('wrote app-icon.png', png.length, 'bytes');
