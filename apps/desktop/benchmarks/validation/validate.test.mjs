// Self-test of the dataset validator (Node's built-in runner): `node --test benchmarks/validation/`.
// Fixtures are synthetic byte blobs, not photographs — this tests the validator, not any model.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { coverage, validateDataset } from './validate.mjs'

function dataset(samples, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'assessx-validation-'))
  mkdirSync(join(dir, 'images'))
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes)
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      schema: 'assessx/phone-validation-manifest/v1',
      dataset: { name: 'selftest', version: '0', collected: '2026-01-01/2026-01-02', consentProtocol: 'TEST', labellingGuideVersion: '1' },
      samples,
    }),
  )
  return dir
}
const blob = (text) => Buffer.from(text)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const A = blob('a')
const B = blob('b')
const present = {
  id: 's1', file: 'images/a.bin', sha256: sha(A), label: 'PHONE_PRESENT', person: 'P01', camera: 'C1', room: 'R1', lighting: 'normal',
  phone_size: 'large', phone_visibility: 'full', phone_position: 'in_hand_chest_level', phone_orientation: 'portrait_screen_facing',
  phone_box: { x: 0.4, y: 0.4, width: 0.2, height: 0.3 }, distractor_type: 'none', consent_ref: 'CR-1', split: 'calibration', labelled_by: 'L1', reviewed_by: 'L2',
}
const absent = {
  id: 's2', file: 'images/b.bin', sha256: sha(B), label: 'PHONE_ABSENT', person: 'P02', camera: 'C1', room: 'R1', lighting: 'dim',
  phone_visibility: 'none', distractor_type: 'remote', consent_ref: 'CR-2', split: 'holdout', labelled_by: 'L1', reviewed_by: 'L2',
}
const files = { 'images/a.bin': A, 'images/b.bin': B }

test('a well-formed dataset is valid and its coverage is reported', () => {
  const { problems, manifest } = validateDataset(dataset([present, absent], files))
  assert.deepEqual(problems, [])
  const c = coverage(manifest.samples)
  assert.equal(c.people, 2)
  assert.deepEqual(c.label, { PHONE_PRESENT: 1, PHONE_ABSENT: 1 })
  assert.deepEqual(c.distractor_type, { remote: 1 })
})

test('rejects wrong enums, missing phone fields, and phone fields on an absent sample', () => {
  const bad = [
    { ...present, lighting: 'sunny' },
    { ...present, id: 's3', phone_box: undefined },
    { ...absent, id: 's4', phone_size: 'large' },
  ]
  const { problems } = validateDataset(dataset(bad, files))
  assert.ok(problems.some((p) => p.includes('lighting')))
  assert.ok(problems.some((p) => p.includes('phone_box is required')))
  assert.ok(problems.some((p) => p.includes('must be omitted when PHONE_ABSENT')))
})

test('rejects tampered files, self-review, non-pseudonymous people and person leakage across splits', () => {
  const bad = [
    { ...present, sha256: sha(blob('other')) },
    { ...absent, reviewed_by: 'L1' },
    { ...absent, id: 's5', person: 'Alice' },
    { ...absent, id: 's6', person: 'P01', split: 'holdout' }, // P01 is also in calibration
  ]
  const { problems } = validateDataset(dataset(bad, files))
  assert.ok(problems.some((p) => p.includes('SHA-256 does not match')))
  assert.ok(problems.some((p) => p.includes('reviewed_by must be a different person')))
  assert.ok(problems.some((p) => p.includes('pseudonymous')))
  assert.ok(problems.some((p) => p.includes('more than one split')))
})
