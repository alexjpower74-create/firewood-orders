// The seed's placeholder photo is a real PNG: signature, IHDR, CRCs checked by zlib, IDAT inflates to the image rows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { crc32, samplePng } from '../src/png.js'

test('crc32 matches zlib', () => {
  const bytes = new TextEncoder().encode('IEND')
  assert.equal(crc32(bytes), 0xae426082)
  assert.equal(crc32(bytes), zlib.crc32(bytes))
})

test('the SAMPLE placeholder is a valid 240 × 120 RGB PNG with the letters drawn', () => {
  const png = samplePng()
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const chunks = []
  for (let o = 8; o < png.length; ) {
    const len = view.getUint32(o)
    const type = new TextDecoder().decode(png.slice(o + 4, o + 8))
    const data = png.slice(o + 8, o + 8 + len)
    assert.equal(view.getUint32(o + 8 + len), zlib.crc32(png.slice(o + 4, o + 8 + len)), `${type} CRC`)
    chunks.push({ type, data })
    o += 12 + len
  }
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'IDAT', 'IEND'],
  )
  const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset)
  assert.deepEqual([ihdr.getUint32(0), ihdr.getUint32(4), ihdr.getUint8(8), ihdr.getUint8(9)], [240, 120, 8, 2])
  const raw = zlib.inflateSync(chunks[1].data)
  assert.equal(raw.length, (240 * 3 + 1) * 120)
  let ink = 0
  for (let y = 0; y < 120; y++) {
    const row = y * 721
    assert.equal(raw[row], 0, 'filter byte')
    for (let x = 0; x < 240; x++) if (raw[row + 1 + x * 3] === 48) ink++
  }
  assert.ok(ink > 1000 && ink < (240 * 120) / 2, `ink pixels ${ink}`)
})
