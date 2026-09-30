// Phone-detector validation data (Phase 5B): selects labelled images from COCO val2017.
//
// Why COCO: it is the only large, openly available, human-labelled set covering both phones and the
// desk objects that could be confused with one (laptop, book, remote, keyboard, mouse). Its images
// are generic scenes, not webcam proctoring frames — results are a sanity check of the model, NOT a
// basis for a production threshold on their own (see README.md).
//
// Only the annotation file member is read from COCO's 241 MB annotations zip (HTTP range requests);
// images are downloaded individually into the git-ignored cache and never committed. Each image's
// COCO licence id is recorded in the manifest. Selection is deterministic (sorted by image id).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const cache = join(here, '..', '.cache', 'coco')
const ZIP_URL = 'http://images.cocodataset.org/annotations/annotations_trainval2017.zip'
const MEMBER = 'annotations/instances_val2017.json'
const IMAGE_URL = (file) => `http://images.cocodataset.org/val2017/${file}`

/** Negative categories: present in the image while no cell phone is annotated. */
const NEGATIVES = ['laptop', 'book', 'remote', 'keyboard', 'mouse']
const PER_NEGATIVE = 40

async function range(start, end) {
  const response = await fetch(ZIP_URL, { headers: { Range: `bytes=${start}-${end}` } })
  if (response.status !== 206) throw new Error(`range request failed: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Reads one member of a remote zip using its central directory (no full download). */
async function zipMember(name) {
  const head = await fetch(ZIP_URL, { method: 'HEAD' })
  const size = Number(head.headers.get('content-length'))
  const tail = await range(size - 65_536, size - 1)
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('end of central directory not found')
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  const cd = await range(cdOffset, cdOffset + cdSize - 1)
  for (let p = 0; p < cd.length; ) {
    const method = cd.readUInt16LE(p + 10)
    const compressed = cd.readUInt32LE(p + 20)
    const nameLength = cd.readUInt16LE(p + 28)
    const extraLength = cd.readUInt16LE(p + 30)
    const commentLength = cd.readUInt16LE(p + 32)
    const localOffset = cd.readUInt32LE(p + 42)
    const entry = cd.subarray(p + 46, p + 46 + nameLength).toString()
    if (entry === name) {
      const local = await range(localOffset, localOffset + 29)
      const dataStart = localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
      const data = await range(dataStart, dataStart + compressed - 1)
      return method === 8 ? inflateRawSync(data) : data
    }
    p += 46 + nameLength + extraLength + commentLength
  }
  throw new Error(`${name} not found in zip`)
}

async function main() {
  mkdirSync(join(cache, 'images'), { recursive: true })
  const annotationsPath = join(cache, 'instances_val2017.json')
  if (!existsSync(annotationsPath)) {
    console.log('[coco] extracting annotations member via range requests…')
    writeFileSync(annotationsPath, await zipMember(MEMBER))
  }
  const coco = JSON.parse(readFileSync(annotationsPath, 'utf8'))
  const categoryId = Object.fromEntries(coco.categories.map((c) => [c.name, c.id]))
  const images = new Map(coco.images.map((image) => [image.id, image]))
  const byImage = new Map()
  for (const a of coco.annotations) {
    if (!byImage.has(a.image_id)) byImage.set(a.image_id, [])
    byImage.get(a.image_id).push(a)
  }

  const phone = categoryId['cell phone']
  const entries = []
  const ids = [...byImage.keys()].sort((a, b) => a - b)
  for (const id of ids) {
    const annotations = byImage.get(id)
    const phones = annotations.filter((a) => a.category_id === phone && !a.iscrowd)
    if (phones.length === 0 || annotations.some((a) => a.category_id === phone && a.iscrowd)) continue
    const image = images.get(id)
    const largest = Math.max(...phones.map((a) => (a.bbox[2] * a.bbox[3]) / (image.width * image.height)))
    entries.push({ id, file: image.file_name, license: image.license, label: 'phone', group: 'phone', phoneAreaRatio: largest })
  }
  for (const name of NEGATIVES) {
    let taken = 0
    for (const id of ids) {
      if (taken >= PER_NEGATIVE) break
      const annotations = byImage.get(id)
      if (annotations.some((a) => a.category_id === phone)) continue
      if (!annotations.some((a) => a.category_id === categoryId[name])) continue
      if (entries.some((e) => e.id === id)) continue
      const image = images.get(id)
      entries.push({ id, file: image.file_name, license: image.license, label: 'no-phone', group: name })
      taken++
    }
  }

  let downloaded = 0
  for (const entry of entries) {
    const path = join(cache, 'images', entry.file)
    if (!existsSync(path)) {
      const response = await fetch(IMAGE_URL(entry.file))
      if (!response.ok) throw new Error(`image ${entry.file}: HTTP ${response.status}`)
      writeFileSync(path, Buffer.from(await response.arrayBuffer()))
      downloaded++
    }
    entry.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  const licenses = Object.fromEntries(coco.licenses.map((l) => [l.id, l.name]))
  writeFileSync(join(cache, 'manifest.json'), JSON.stringify({ source: 'COCO val2017', licenses, entries }, null, 1))
  const counts = entries.reduce((acc, e) => ((acc[e.group] = (acc[e.group] ?? 0) + 1), acc), {})
  console.log(`[coco] ${entries.length} images (${downloaded} downloaded):`, JSON.stringify(counts))
}

main().catch((error) => {
  console.error('[coco]', error.message)
  process.exit(1)
})
