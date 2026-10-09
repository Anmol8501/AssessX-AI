import { describe, expect, it } from 'vitest'
import { cutOff, FramingDetector, inView } from '../detectors/framing'
import { frame, payload, raw } from './fixtures'

const shoulder = (x: number, y: number, visibility = 0.95) => ({ x, y, visibility })
const face = (box: { x: number; y: number; width: number; height: number }) => ({ box, score: 0.9 })

describe('framing detector (head and chest in view)', () => {
  it('counts a shoulder only when seen, inside the frame, and high enough to show the chest', () => {
    expect(inView(shoulder(0.3, 0.75))).toBe(true)
    expect(inView(shoulder(0.3, 0.75, 0.2))).toBe(false) // not seen
    expect(inView(shoulder(-0.05, 0.75))).toBe(false) // outside the frame
    expect(inView(shoulder(0.3, 0.95))).toBe(false) // at the bottom edge: no chest below it
  })

  it('treats a face box touching an edge as cut off', () => {
    expect(cutOff({ x: 0.3, y: 0.1, width: 0.3, height: 0.4 })).toBe(false)
    expect(cutOff({ x: 0, y: 0.1, width: 0.3, height: 0.4 })).toBe(true)
    expect(cutOff({ x: 0.3, y: 0.7, width: 0.3, height: 0.3 })).toBe(true)
  })

  it('reports shoulders in view and whether the face is cut off; nothing without a face or a pose', async () => {
    const detector = new FramingDetector()
    await detector.init()
    const framed = payload({
      faces: [face({ x: 0.35, y: 0.15, width: 0.3, height: 0.35 })],
      shoulders: [shoulder(0.3, 0.75), shoulder(0.7, 0.76)],
      tasks: { poseLandmarker: 'OK' },
    })
    expect(detector.process(frame(), raw(framed))[0]?.metadata).toEqual({ shouldersVisible: 2, faceCutOff: false, lowestShoulderY: 0.76 })

    const halfFace = payload({
      faces: [face({ x: 0, y: 0.15, width: 0.3, height: 0.35 })],
      shoulders: [shoulder(0.3, 0.97), shoulder(0.7, 0.98, 0.1)],
      tasks: { poseLandmarker: 'OK' },
    })
    expect(detector.process(frame(), raw(halfFace))[0]?.metadata).toMatchObject({ shouldersVisible: 0, faceCutOff: true })

    expect(detector.process(frame(), raw(payload({ faces: [], tasks: { poseLandmarker: 'SKIPPED' } })))).toEqual([])
    expect(detector.process(frame(), raw(payload({ faces: [face({ x: 0.3, y: 0.1, width: 0.3, height: 0.3 })], tasks: { poseLandmarker: 'UNAVAILABLE' } })))).toEqual([])
    expect(detector.state).toBe('ERROR') // the pose model is missing: reported, never "framed"
  })
})
