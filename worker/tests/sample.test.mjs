// The SAMPLE data: PIN hashes re-derive from the public SAMPLE PINs, and the generated files are not stale.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPin, PBKDF2_ITERATIONS } from '../src/auth.js'
import { SAMPLE_PINS, SAMPLE_SETTINGS, sampleStatements } from '../src/sample.js'
import { renderSql } from '../tools/build-sample-data.mjs'

const WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('SAMPLE PIN hashes are PBKDF2-SHA256 × 100 000 of 1357 and 2580', async () => {
  assert.equal(PBKDF2_ITERATIONS, 100000)
  assert.equal(SAMPLE_PINS.dealer.pin, '1357')
  assert.equal(SAMPLE_PINS.driver.pin, '2580')
  assert.equal(await hashPin('1357', SAMPLE_PINS.dealer.salt), SAMPLE_PINS.dealer.hash)
  assert.equal(await hashPin('2580', SAMPLE_PINS.driver.salt), SAMPLE_PINS.driver.hash)
  assert.notEqual(await hashPin('1358', SAMPLE_PINS.dealer.salt), SAMPLE_PINS.dealer.hash)
})

test('generated sample files match their sources', () => {
  const r = spawnSync(process.execPath, ['tools/build-sample-data.mjs', '--check'], { cwd: WORKER, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  // …and the comparison can see a change: one different value renders different SQL than the committed file.
  const committed = readFileSync(path.join(WORKER, 'migrations', '0002_sample.sql'), 'utf8')
  assert.equal(renderSql(sampleStatements()), committed)
  const changed = sampleStatements()
  changed[0].params[3] = 211
  assert.notEqual(renderSql(changed), committed)
})

test('SAMPLE dealer shows SAMPLE and the yard is Springdale', () => {
  assert.match(SAMPLE_SETTINGS.name, /SAMPLE/)
  assert.equal(SAMPLE_SETTINGS.yard.label, 'Our yard, Springdale (SAMPLE)')
  assert.equal(sampleStatements()[0].params[3], 210) // 3 skids × 70 bags
})
