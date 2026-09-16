// 生成地图 marker 用的 48x48 橘色圆点 PNG,无第三方依赖。用法: node scripts/make-marker.js miniprogram/pages/index/marker.png
const zlib = require('zlib');
const fs = require('fs');
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const W = 48, H = 48, raw = [];
for (let y = 0; y < H; y++) {
  raw.push(0);
  for (let x = 0; x < W; x++) {
    const dx = x - 24, dy = y - 24, r = Math.sqrt(dx * dx + dy * dy);
    const edge = r > 19 && r <= 22;
    raw.push(edge ? 255 : 255, edge ? 255 : 138, edge ? 255 : 61, r <= 22 ? 255 : 0);
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(process.argv[2], Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0)),
]));
