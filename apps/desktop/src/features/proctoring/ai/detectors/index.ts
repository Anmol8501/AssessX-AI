import type { Detector } from '../types'
import { FacePresenceDetector } from './face'
import { GazeDetector } from './gaze'
import { HeadPoseDetector } from './headPose'
import { ObjectPresenceDetector, PhoneDetector } from './object'
import { FramingDetector } from './framing'
import { FrameQualityDetector } from './quality'
import { FaceTrackingDetector } from './tracking'

/** The production detectors (face presence/count, tracking, head pose, gaze, objects, frame quality), all reading the MediaPipe runtime's per-frame result. */
export function createMediaPipeDetectors(): Detector[] {
  return [
    new FacePresenceDetector(),
    new FaceTrackingDetector(),
    new HeadPoseDetector(),
    new GazeDetector(),
    new ObjectPresenceDetector(),
    new FrameQualityDetector(),
    new FramingDetector(),
  ]
}

export { FacePresenceDetector, FaceTrackingDetector, FramingDetector, FrameQualityDetector, GazeDetector, HeadPoseDetector, ObjectPresenceDetector, PhoneDetector }
