// pptFooter.js
// Pure-Node PNG utility (no external image libraries): decodes the footer
// graphic attached by the user, crops it into two transparent decorative
// pieces and writes them as PNGs used on every report slide:
//   - left  : the blue bar (bottom-left corner of the source image)
//   - right : the red / yellow / green cluster (right side of the source)
// Near-white pixels are converted to transparent so the pieces blend into the
// slide background.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SRC_PATH = path.join(__dirname, 'assets', 'footer_src.png');
const LEFT_OUT = path.join(__dirname, 'assets', '_footer_left.png');
const RIGHT_OUT = path.join(__dirname, 'assets', '_footer_right.png');

// ------------------------------------------------------------------ PNG codec
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function decodePng(buf) {
  let pos = 8, idat = [], w = 0, h = 0, ctype = 0, bitDepth = 0;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; ctype = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (ctype !== 6) throw new Error(`Unsupported PNG color type ${ctype} (need RGBA)`);
  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = row[x]; break;
        case 1: val = row[x] + a; break;
        case 2: val = row[x] + b; break;
        case 3: val = row[x] + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`Bad PNG filter ${filter}`);
      }
      out[y * stride + x] = val & 0xff;
    }
  }
  return { w, h, data: out };
}

// Crop + make near-white transparent. Returns encoded PNG buffer.
function cropAndTrim(src, x0, y0, cw, ch) {
  const { w, h, data } = decodePng(src);
  x0 = Math.max(0, Math.min(w, x0));
  y0 = Math.max(0, Math.min(h, y0));
  cw = Math.min(cw, w - x0);
  ch = Math.min(ch, h - y0);
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * w + (x0 + x)) * 4;
      const di = (y * cw + x) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
      // near-white background -> transparent
      if (out[di] > 245 && out[di + 1] > 245 && out[di + 2] > 245 && data[si + 3] > 0) out[di + 3] = 0;
    }
  }
  return encodePng(cw, ch, out);
}

// ------------------------------------------------------------------ public
// Generates the two footer pieces (cached). Returns { left, right } paths.
function ensureFooterCrops(opts = {}) {
  const srcPath = opts.srcPath || SRC_PATH;
  const leftOut = opts.leftOut || LEFT_OUT;
  const rightOut = opts.rightOut || RIGHT_OUT;
  if (fs.existsSync(leftOut) && fs.existsSync(rightOut)) return { left: leftOut, right: rightOut };
  if (!fs.existsSync(srcPath)) return null;

  const src = fs.readFileSync(srcPath);
  const { w, h } = decodePng(src);
  // blue bar: bottom-left; cluster: right side (green top-right + red/yellow bottom-right)
  const left = cropAndTrim(src, 0, Math.round(h * 0.45), Math.round(w * 0.44), Math.round(h * 0.55));
  const right = cropAndTrim(src, Math.round(w * 0.46), 0, Math.round(w * 0.54), h);
  fs.writeFileSync(leftOut, left);
  fs.writeFileSync(rightOut, right);
  return { left: leftOut, right: rightOut };
}

module.exports = { ensureFooterCrops };