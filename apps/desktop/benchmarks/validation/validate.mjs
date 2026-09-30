// Validates a phone-detection validation dataset (manifest + images) against manifest.schema.json
// and the collection rules in README.md, then prints its coverage. No dependencies.
//
// Usage: node benchmarks/validation/validate.mjs <dataset-dir>
// Exit code 0 = valid, 1 = invalid (every problem is listed).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const schema = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'manifest.schema.json'), 'utf8'))
const sampleSchema = schema.$defs.sample
const enums = Object.fromEntries(Object.entries(sampleSchema.properties).filter(([, v]) => v.enum).map(([k, v]) => [k, v.enum]))
const PRESENT_ONLY = ['phone_size', 'phone_position', 'phone_orientation', 'phone_box']

export function validateDataset(dir) {
  const problems = []
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return { problems: [`no manifest.json in ${dir}`], manifest: null }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.schema !== schema.properties.schema.const) problems.push(`schema must be "${schema.properties.schema.const}"`)
  for (const key of schema.properties.dataset.required) if (!manifest.dataset?.[key]) problems.push(`dataset.${key} is required`)
  const samples = Array.isArray(manifest.samples) ? manifest.samples : []
  if (!Array.isArray(manifest.samples)) problems.push('samples must be an array')

  const ids = new Set()
  const splitsByPerson = new Map()
  for (const [index, s] of samples.entries()) {
    const at = `samples[${index}] (${s?.id ?? '?'})`
    for (const key of sampleSchema.required) if (s[key] === undefined || s[key] === '') problems.push(`${at}: ${key} is required`)
    for (const key of Object.keys(s)) if (!(key in sampleSchema.properties)) problems.push(`${at}: unknown field ${key}`)
    for (const [key, allowed] of Object.entries(enums)) if (s[key] !== undefined && !allowed.includes(s[key])) problems.push(`${at}: ${key} "${s[key]}" is not one of ${allowed.join(', ')}`)
    if (s.person !== undefined && !/^P[0-9]{2,4}$/.test(s.person)) problems.push(`${at}: person must be a pseudonymous id like P07`)
    if (ids.has(s.id)) problems.push(`${at}: duplicate id`)
    ids.add(s.id)
    if (s.labelled_by && s.labelled_by === s.reviewed_by) problems.push(`${at}: reviewed_by must be a different person from labelled_by`)

    if (s.label === 'PHONE_PRESENT') {
      for (const key of PRESENT_ONLY) if (s[key] === undefined) problems.push(`${at}: ${key} is required when PHONE_PRESENT`)
      if (s.phone_visibility === 'none') problems.push(`${at}: PHONE_PRESENT cannot have phone_visibility "none"`)
    } else if (s.label === 'PHONE_ABSENT') {
      for (const key of PRESENT_ONLY) if (s[key] !== undefined) problems.push(`${at}: ${key} must be omitted when PHONE_ABSENT`)
      if (s.phone_visibility !== undefined && s.phone_visibility !== 'none') problems.push(`${at}: PHONE_ABSENT must have phone_visibility "none"`)
    }
    if (s.phone_box) {
      const { x, y, width, height } = s.phone_box
      if (![x, y, width, height].every((v) => typeof v === 'number') || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.0001 || y + height > 1.0001) {
        problems.push(`${at}: phone_box must be normalised and inside the image`)
      }
    }
    const file = s.file ? join(dir, s.file) : null
    if (file && !existsSync(file)) problems.push(`${at}: file ${s.file} not found`)
    else if (file && s.sha256 && createHash('sha256').update(readFileSync(file)).digest('hex') !== s.sha256) problems.push(`${at}: SHA-256 does not match ${s.file}`)
    if (s.person && s.split) {
      if (!splitsByPerson.has(s.person)) splitsByPerson.set(s.person, new Set())
      splitsByPerson.get(s.person).add(s.split)
    }
  }
  for (const [person, splits] of splitsByPerson) if (splits.size > 1) problems.push(`person ${person} appears in more than one split (${[...splits].join(', ')}) — split by person, not by frame`)
  return { problems, manifest }
}

export function coverage(samples) {
  const count = (key) => samples.reduce((acc, s) => ((acc[s[key] ?? '—'] = (acc[s[key] ?? '—'] ?? 0) + 1), acc), {})
  const present = samples.filter((s) => s.label === 'PHONE_PRESENT')
  return {
    samples: samples.length,
    label: count('label'),
    people: new Set(samples.map((s) => s.person)).size,
    cameras: new Set(samples.map((s) => s.camera)).size,
    rooms: new Set(samples.map((s) => s.room)).size,
    split: count('split'),
    lighting: count('lighting'),
    phone_size: present.reduce((a, s) => ((a[s.phone_size] = (a[s.phone_size] ?? 0) + 1), a), {}),
    phone_visibility: present.reduce((a, s) => ((a[s.phone_visibility] = (a[s.phone_visibility] ?? 0) + 1), a), {}),
    phone_orientation: present.reduce((a, s) => ((a[s.phone_orientation] = (a[s.phone_orientation] ?? 0) + 1), a), {}),
    distractor_type: samples.filter((s) => s.label === 'PHONE_ABSENT').reduce((a, s) => ((a[s.distractor_type] = (a[s.distractor_type] ?? 0) + 1), a), {}),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('usage: node benchmarks/validation/validate.mjs <dataset-dir>')
    process.exit(1)
  }
  const { problems, manifest } = validateDataset(dir)
  if (manifest) console.log(JSON.stringify(coverage(manifest.samples ?? []), null, 1))
  if (problems.length) {
    console.error(`INVALID — ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log('VALID')
}
