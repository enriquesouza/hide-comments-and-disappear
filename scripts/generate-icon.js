#!/usr/bin/env node
'use strict';

/*
 * generate-icon.js
 *
 * Renders the "hide comments / disappear" icon as a 256x256 8-bit RGBA PNG
 * and writes it to <repo root>/icon.png (resolved relative to this script).
 * After writing, it re-reads the file and verifies the PNG signature, every
 * chunk CRC, the IHDR fields, and the inflated scanline payload.
 *
 * Design:
 *   - Rounded square filling the canvas (generous corner radius) with a
 *     vertical gradient #3b3b58 (top) -> #1c1c2e (bottom); fully transparent
 *     outside the rounded square.
 *   - Two thick parallel "//" slashes in near-white (#f0f0f5), drawn as
 *     capsule distance tests (no fonts, no text rendering).
 *   - A bold diagonal strike-through in accent #ff6b81, running top-right to
 *     bottom-left at a different angle and slightly thicker, crossing the
 *     slashes out.
 *
 * Zero dependencies: only Node.js built-ins (fs, path, zlib, Buffer).
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const OUT_PATH = path.join(__dirname, '..', 'icon.png');

/* ------------------------------ CRC32 (PNG) ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------------------- PNG chunk helper ---------------------------- */

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0); // chunk data length
  out.write(type, 4, 'ascii'); // chunk type
  data.copy(out, 8); // chunk data
  // CRC covers chunk type + chunk data.
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/* -------------------------------- geometry -------------------------------- */

const CENTER = SIZE / 2; // 128
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Signed distance to a rounded box centered at (cx, cy) with half-side `half`
// and corner radius `radius`. Negative inside, positive outside.
function sdRoundBox(px, py, cx, cy, half, radius) {
  const qx = Math.abs(px - cx) - (half - radius);
  const qy = Math.abs(py - cy) - (half - radius);
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

// Squared distance from point (px, py) to segment (ax, ay)-(bx, by).
function segDistSq(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp(
    ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby),
    0,
    1
  );
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return dx * dx + dy * dy;
}

/* ------------------------------- motif layout ------------------------------ */

// Rounded-square "app icon" background: 10px margin, generous 56px corners.
const BOX_HALF = 118; // box spans 10..246
const BOX_RADIUS = 56;

// "//" slashes: two steep parallel capsule strokes, direction (1, -3)/sqrt(10)
// (about 72 degrees from horizontal, like the "/" glyph).
const INV_SQRT10 = 1 / Math.sqrt(10);
const SLASH_DIR = { x: 1 * INV_SQRT10, y: -3 * INV_SQRT10 }; // along stroke
const SLASH_NRM = { x: 3 * INV_SQRT10, y: 1 * INV_SQRT10 }; // unit normal
const SLASH_HALF_LEN = 78; // half length of each slash segment
const SLASH_HALF_W = 15; // half thickness (30px wide strokes)
const SLASH_SPREAD = 32; // perpendicular offset of each slash from center

function slashAt(offset) {
  const cx = CENTER + offset * SLASH_NRM.x;
  const cy = CENTER + offset * SLASH_NRM.y;
  return {
    ax: cx - SLASH_HALF_LEN * SLASH_DIR.x, // bottom-left end
    ay: cy - SLASH_HALF_LEN * SLASH_DIR.y,
    bx: cx + SLASH_HALF_LEN * SLASH_DIR.x, // top-right end
    by: cy + SLASH_HALF_LEN * SLASH_DIR.y,
  };
}

const slashes = [slashAt(-SLASH_SPREAD), slashAt(SLASH_SPREAD)];

// Strike-through: top-right -> bottom-left, direction (-3, 2)/sqrt(13)
// (about 34 degrees from horizontal), slightly thicker than the slashes.
const INV_SQRT13 = 1 / Math.sqrt(13);
const STRIKE_DIR = { x: -3 * INV_SQRT13, y: 2 * INV_SQRT13 };
const STRIKE_HALF_LEN = 100;
const STRIKE_HALF_W = 18; // half thickness (36px wide stroke)
const strike = {
  ax: CENTER - STRIKE_HALF_LEN * STRIKE_DIR.x, // top-right end
  ay: CENTER - STRIKE_HALF_LEN * STRIKE_DIR.y,
  bx: CENTER + STRIKE_HALF_LEN * STRIKE_DIR.x, // bottom-left end
  by: CENTER + STRIKE_HALF_LEN * STRIKE_DIR.y,
};

/* --------------------------------- colors ---------------------------------- */

const TOP = { r: 0x3b, g: 0x3b, b: 0x58 }; // #3b3b58 gradient top
const BOTTOM = { r: 0x1c, g: 0x1c, b: 0x2e }; // #1c1c2e gradient bottom
const MOTIF = { r: 0xf0, g: 0xf0, b: 0xf5 }; // #f0f0f5 slashes
const ACCENT = { r: 0xff, g: 0x6b, b: 0x81 }; // #ff6b81 strike-through

/* -------------------------------- rendering -------------------------------- */

// Sample one point. Returns premultiplied-ish [r, g, b, a] where a is 0 or 1.
function samplePoint(px, py) {
  if (sdRoundBox(px, py, CENTER, CENTER, BOX_HALF, BOX_RADIUS) >= 0) {
    return [0, 0, 0, 0]; // fully transparent outside the rounded square
  }

  // Vertical gradient across the box interior.
  const t = clamp((py - (CENTER - BOX_HALF)) / (2 * BOX_HALF), 0, 1);
  let r = TOP.r + (BOTTOM.r - TOP.r) * t;
  let g = TOP.g + (BOTTOM.g - TOP.g) * t;
  let b = TOP.b + (BOTTOM.b - TOP.b) * t;

  // Near-white slashes "//".
  for (const s of slashes) {
    if (segDistSq(px, py, s.ax, s.ay, s.bx, s.by) <= SLASH_HALF_W * SLASH_HALF_W) {
      r = MOTIF.r;
      g = MOTIF.g;
      b = MOTIF.b;
      break;
    }
  }

  // Accent strike-through drawn on top, crossing the slashes out.
  if (
    segDistSq(px, py, strike.ax, strike.ay, strike.bx, strike.by) <=
    STRIKE_HALF_W * STRIKE_HALF_W
  ) {
    r = ACCENT.r;
    g = ACCENT.g;
    b = ACCENT.b;
  }

  return [r, g, b, 1];
}

// Render all pixels into the raw PNG scanline buffer (filter byte 0 per row),
// using 3x3 supersampling for light anti-aliasing.
function renderPixels() {
  const stride = 1 + SIZE * 4; // filter byte + RGBA row
  const raw = Buffer.alloc(SIZE * stride); // zero-filled -> transparent black
  const SS = 3;
  const invSS = 1 / SS;
  const samples = SS * SS;

  for (let y = 0; y < SIZE; y++) {
    const row = y * stride;
    raw[row] = 0; // filter type 0 (None)
    for (let x = 0; x < SIZE; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let j = 0; j < SS; j++) {
        const py = y + (j + 0.5) * invSS;
        for (let i = 0; i < SS; i++) {
          const px = x + (i + 0.5) * invSS;
          const [r, g, b, a] = samplePoint(px, py);
          sr += r * a;
          sg += g * a;
          sb += b * a;
          sa += a;
        }
      }
      if (sa > 0) {
        const o = row + 1 + x * 4;
        raw[o] = Math.round(sr / sa);
        raw[o + 1] = Math.round(sg / sa);
        raw[o + 2] = Math.round(sb / sa);
        raw[o + 3] = Math.round((sa / samples) * 255);
      }
      // sa === 0 leaves RGBA as 0,0,0,0 (buffer is zero-initialized).
    }
  }
  return raw;
}

/* ------------------------------- PNG encoding ------------------------------ */

function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); // width
  ihdr.writeUInt32BE(SIZE, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6 = truecolor + alpha (RGBA)
  ihdr[10] = 0; // compression method: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace method: none

  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- verification ------------------------------ */

function verifyPng(filePath) {
  const buf = fs.readFileSync(filePath);
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < SIG.length || buf.compare(SIG, 0, SIG.length, 0, SIG.length) !== 0) {
    throw new Error('invalid PNG signature');
  }

  const idatParts = [];
  let ihdr = null;
  let lastType = null;
  let off = SIG.length;

  // Walk every chunk: validate type characters and CRCs.
  while (off < buf.length) {
    if (off + 8 > buf.length) throw new Error('truncated chunk header');
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`bad chunk type "${type}"`);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) throw new Error(`truncated data/CRC in ${type}`);
    const stored = buf.readUInt32BE(dataEnd);
    const computed = crc32(buf.subarray(off + 4, dataEnd));
    if (stored !== computed) {
      throw new Error(
        `CRC mismatch in ${type} (stored 0x${stored.toString(16)}, ` +
          `computed 0x${computed.toString(16)})`
      );
    }
    if (type === 'IHDR') {
      if (len !== 13) throw new Error('IHDR length must be 13');
      ihdr = {
        width: buf.readUInt32BE(dataStart),
        height: buf.readUInt32BE(dataStart + 4),
        bitDepth: buf[dataStart + 8],
        colorType: buf[dataStart + 9],
        compression: buf[dataStart + 10],
        filter: buf[dataStart + 11],
        interlace: buf[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      idatParts.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (len !== 0) throw new Error('IEND must be empty');
    }
    lastType = type;
    off = dataEnd + 4;
  }

  if (!ihdr) throw new Error('missing IHDR chunk');
  if (lastType !== 'IEND') throw new Error('missing IEND chunk');
  if (ihdr.width !== SIZE || ihdr.height !== SIZE) {
    throw new Error(`unexpected IHDR dimensions: ${ihdr.width}x${ihdr.height}`);
  }
  if (ihdr.bitDepth !== 8 || ihdr.colorType !== 6) {
    throw new Error(
      `unexpected IHDR bit depth/color type: ${ihdr.bitDepth}/${ihdr.colorType}`
    );
  }
  if (ihdr.compression !== 0 || ihdr.filter !== 0 || ihdr.interlace !== 0) {
    throw new Error('unexpected IHDR compression/filter/interlace flags');
  }

  // Inflate IDAT and check the raw scanline payload (filter byte 0 per row).
  const raw = zlib.inflateSync(Buffer.concat(idatParts));
  const stride = 1 + SIZE * 4;
  if (raw.length !== SIZE * stride) {
    throw new Error(`inflated IDAT size ${raw.length} != expected ${SIZE * stride}`);
  }
  for (let y = 0; y < SIZE; y++) {
    if (raw[y * stride] !== 0) {
      throw new Error(`scanline ${y}: expected filter byte 0, got ${raw[y * stride]}`);
    }
  }
  return ihdr;
}

/* ----------------------------------- main ---------------------------------- */

function main() {
  const raw = renderPixels();
  const png = encodePng(raw);
  fs.writeFileSync(OUT_PATH, png);

  const ihdr = verifyPng(OUT_PATH); // re-read + assert signature, CRCs, IHDR
  const stats = fs.statSync(OUT_PATH);
  console.log(
    `OK ${path.resolve(OUT_PATH)} — ${stats.size} bytes, ` +
      `${ihdr.width}x${ihdr.height}, bit depth ${ihdr.bitDepth}, ` +
      `color type ${ihdr.colorType} (RGBA)`
  );
}

try {
  main();
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
}
