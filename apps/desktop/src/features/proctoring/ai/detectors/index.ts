import type { Detector } from '../types'
import { FacePresenceDetector } from './face'
import { GazeDetector } from './gaze'
import { HeadPoseDetector } from './headPose'
import { PhoneDetector } from './object'
import { FrameQualityDetector } from './quality'
import { FaceTrackingDetector } from './tracking'

/** The Phase 5B production detectors, all reading the MediaPipe runtime's per-frame result. */
export function createMediaPipeDetectors(): Detector[] {
  return [
    new FacePresenceDetector(),
    new FaceTrackingDetector(),
    new HeadPoseDetector(),
    new GazeDetector(),
    new PhoneDetector(),
    new FrameQualityDetector(),
  ]
}

export { FacePresenceDetector, FaceTrackingDetector, FrameQualityDetector, GazeDetector, HeadPoseDetector, PhoneDetector }
