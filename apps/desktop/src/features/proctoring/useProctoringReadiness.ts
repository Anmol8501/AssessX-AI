import { useCallback, useMemo } from 'react'
import {
  calculateOverallReadiness,
  type ProctoringReadinessState,
} from './devices'
import type { MediaDevice } from './useMediaDevice'
import { useProctoringApi, type DeviceReport } from './useProctoringApi'
import { toServerState } from './devices'

export interface ProctoringReadinessOptions {
  attemptId?: string | null
  requireCamera?: boolean
  requireMicrophone?: boolean
}

export interface UnifiedReadinessReport {
  state: ProctoringReadinessState
  cameraReady: boolean
  microphoneReady: boolean
  failureReason: string | null
  selectedCameraId: string | null
  selectedCameraLabel: string | null
  selectedMicrophoneId: string | null
  selectedMicrophoneLabel: string | null
  reportToBackend(): Promise<void>
}

/**
 * Unified device readiness hook coordinating camera and microphone readiness (Phase 4A Module C).
 */
export function useProctoringReadiness(
  camera: MediaDevice,
  microphone: MediaDevice,
  options?: ProctoringReadinessOptions,
): UnifiedReadinessReport {
  const { reportReadiness } = useProctoringApi()
  const requireCamera = options?.requireCamera ?? true
  const requireMicrophone = options?.requireMicrophone ?? true

  const overallState = useMemo(() => {
    return calculateOverallReadiness(camera.status, microphone.status, {
      requireCamera,
      requireMic: requireMicrophone,
    })
  }, [camera.status, microphone.status, requireCamera, requireMicrophone])

  const failureReason = useMemo(() => {
    if (requireCamera && camera.status !== 'READY') {
      return camera.message || 'Camera is not ready'
    }
    if (requireMicrophone && microphone.status !== 'READY') {
      return microphone.message || 'Microphone is not ready'
    }
    return null
  }, [camera.status, camera.message, microphone.status, microphone.message, requireCamera, requireMicrophone])

  const reportToBackend = useCallback(async () => {
    if (!options?.attemptId) return

    const payload: DeviceReport = {
      camera: toServerState(camera.status),
      microphone: toServerState(microphone.status),
      selected_camera_id: camera.selectedDeviceId,
      selected_camera_label: camera.selectedLabel,
      selected_microphone_id: microphone.selectedDeviceId,
      selected_microphone_label: microphone.selectedLabel,
      readiness_state: overallState,
      device_failure_reason: failureReason,
    }

    try {
      await reportReadiness(options.attemptId, payload)
    } catch {
      // Best-effort reporting during readiness check
    }
  }, [
    options?.attemptId,
    camera.status,
    camera.selectedDeviceId,
    camera.selectedLabel,
    microphone.status,
    microphone.selectedDeviceId,
    microphone.selectedLabel,
    overallState,
    failureReason,
    reportReadiness,
  ])

  return {
    state: overallState,
    cameraReady: camera.status === 'READY',
    microphoneReady: microphone.status === 'READY',
    failureReason,
    selectedCameraId: camera.selectedDeviceId,
    selectedCameraLabel: camera.selectedLabel,
    selectedMicrophoneId: microphone.selectedDeviceId,
    selectedMicrophoneLabel: microphone.selectedLabel,
    reportToBackend,
  }
}
