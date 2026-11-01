// tools/make-icons.js
// Draws Bot's app icons (public/icon-192.png and icon-512.png): a purple square with a white "B".
// Run once with:  node tools/make-icons.js   (the PNG files are committed, so you rarely need to).
// Only built-in modules: a PNG is a signature plus "chunks", each with a CRC checksum; zlib compresses the pixels.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const PURPLE = [147, 51, 234]; // the page's --accent
const WHITE = [255, 255, 255];
const LETTER_B = ["1110", "1001", "1001", "1110", "1001", "1001", "1110"]; // 4 x 7 cells

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size) {
  const cell = Math.floor(size / 14); // the letter is about half the icon high, safely inside the "maskable" circle
  const left = Math.floor((size - 4 * cell) / 2);
  const top = Math.floor((size - 7 * cell) / 2);
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // first byte 0 = "no filter"
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x - left) / cell), cy = Math.floor((y - top) / cell);
      const on = x >= left && y >= top && cx < 4 && cy < 7 && LETTER_B[cy][cx] === "1";
      Buffer.from(on ? WHITE : PURPLE).copy(row, 1 + x * 3);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 2; // 8 bits per channel, colour type 2 = RGB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(__dirname, "..", "public", `icon-${size}.png`), png(size));
  console.log(`wrote public/icon-${size}.png`);
}
