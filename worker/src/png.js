// A placeholder delivery photo for the SAMPLE seed: a tan card with "SAMPLE" in block letters.
// Pure: an uncompressed (stored-block) PNG, so no zlib or CompressionStream is needed.
const GLYPHS = {
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
}

export function samplePng(width = 240, height = 120, word = 'SAMPLE') {
  const bg = [196, 160, 110]
  const ink = [48, 34, 20]
  const scale = Math.max(1, Math.floor(Math.min((width - 20) / (word.length * 6 - 1), (height - 20) / 7)))
  const ox = Math.floor((width - (word.length * 6 - 1) * scale) / 2)
  const oy = Math.floor((height - 7 * scale) / 2)
  const on = (x, y) => {
    const gx = x - ox
    const gy = y - oy
    if (gx < 0 || gy < 0 || gy >= 7 * scale) return false
    const col = Math.floor(gx / scale)
    const g = Math.floor(col / 6)
    if (g >= word.length || col % 6 === 5) return false
    return GLYPHS[word[g]][Math.floor(gy / scale)][col % 6] === '1'
  }
  const raw = new Uint8Array((width * 3 + 1) * height)
  let i = 0
  for (let y = 0; y < height; y++) {
    raw[i++] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const c = on(x, y) ? ink : bg
      raw[i++] = c[0]
      raw[i++] = c[1]
      raw[i++] = c[2]
    }
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit RGB
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0)),
  ])
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typed = concat([new TextEncoder().encode(type), data])
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  out.set(typed, 4)
  v.setUint32(8 + data.length, crc32(typed))
  return out
}

function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535))
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4)
  out[0] = 0x78
  out[1] = 0x01
  let o = 2
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535
    const len = Math.min(65535, raw.length - start)
    out[o++] = b === blocks - 1 ? 1 : 0
    out[o++] = len & 0xff
    out[o++] = len >>> 8
    out[o++] = ~len & 0xff
    out[o++] = (~len >>> 8) & 0xff
    out.set(raw.subarray(start, start + len), o)
    o += len
  }
  let a = 1
  let s = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    s = (s + a) % 65521
  }
  new DataView(out.buffer).setUint32(o, ((s << 16) | a) >>> 0)
  return out
}
