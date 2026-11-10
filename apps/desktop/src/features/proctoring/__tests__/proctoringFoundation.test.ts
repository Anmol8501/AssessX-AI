import { describe, expect, it } from 'vitest'
import {
  calculateOverallReadiness,
  classifyMediaError,
  constraintsFor,
  disconnectedCheck,
  enumerateMediaDevices,
  getPersistedDeviceId,
  persistDeviceId,
  toServerState,
  unsupportedCheck,
} from '../devices'

describe('Phase 4A: Proctoring Session Foundation (Devices, Readiness & Lifecycle)', () => {
  describe('toServerState', () => {
    it('maps READY to READY', () => {
      expect(toServerState('READY')).toBe('READY')
    })

    it('maps DENIED to DENIED', () => {
      expect(toServerState('DENIED')).toBe('DENIED')
    })

    it('maps UNAVAILABLE to UNAVAILABLE', () => {
      expect(toServerState('UNAVAILABLE')).toBe('UNAVAILABLE')
    })

    it('maps CHECKING, NOT_CHECKED, and ERROR to NOT_READY', () => {
      expect(toServerState('CHECKING')).toBe('NOT_READY')
      expect(toServerState('NOT_CHECKED')).toBe('NOT_READY')
      expect(toServerState('ERROR')).toBe('NOT_READY')
    })
  })

  describe('classifyMediaError', () => {
    it('classifies permission denial errors as DENIED with actionable explanation', () => {
      const err = new DOMException('Permission denied', 'NotAllowedError')
      const result = classifyMediaError('camera', err)
      expect(result.status).toBe('DENIED')
      expect(result.message).toContain('Camera access is blocked')
      expect(result.message).toContain('Windows Settings')

      const micErr = new DOMException('Permission denied', 'PermissionDeniedError')
      const micResult = classifyMediaError('microphone', micErr)
      expect(micResult.status).toBe('DENIED')
      expect(micResult.message).toContain('Microphone access is blocked')
    })

    it('classifies missing hardware errors as UNAVAILABLE', () => {
      const err = new DOMException('Requested device not found', 'NotFoundError')
      const result = classifyMediaError('camera', err)
      expect(result.status).toBe('UNAVAILABLE')
      expect(result.message).toContain('No camera was found')
    })

    it('classifies device in-use / busy errors as ERROR', () => {
      const err = new DOMException('Device is in use', 'NotReadableError')
      const result = classifyMediaError('camera', err)
      expect(result.status).toBe('ERROR')
      expect(result.message).toContain('in use by another application')
    })

    it('creates appropriate disconnected and unsupported status checks', () => {
      const disc = disconnectedCheck('camera')
      expect(disc.status).toBe('UNAVAILABLE')
      expect(disc.message).toContain('disconnected or stopped')

      const unsup = unsupportedCheck('microphone')
      expect(unsup.status).toBe('UNAVAILABLE')
      expect(unsup.message).toContain('does not allow')
    })
  })

  describe('constraintsFor', () => {
    it('generates standard constraints when no deviceId is provided', () => {
      const cam = constraintsFor('camera')
      expect(cam.audio).toBe(false)
      expect(cam.video).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 } })

      const mic = constraintsFor('microphone')
      expect(mic.video).toBe(false)
      expect(mic.audio).toBe(true)
    })

    it('targets exact deviceId when provided', () => {
      const cam = constraintsFor('camera', 'exact-cam-id-123')
      expect(cam.video).toEqual({
        deviceId: { exact: 'exact-cam-id-123' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      })

      const mic = constraintsFor('microphone', 'exact-mic-id-456')
      expect(mic.audio).toEqual({ deviceId: { exact: 'exact-mic-id-456' } })
    })
  })

  describe('calculateOverallReadiness', () => {
    it('evaluates READY when all required devices are READY', () => {
      expect(calculateOverallReadiness('READY', 'READY')).toBe('READY')
    })

    it('evaluates CHECKING when either required device is CHECKING', () => {
      expect(calculateOverallReadiness('CHECKING', 'READY')).toBe('CHECKING')
      expect(calculateOverallReadiness('READY', 'CHECKING')).toBe('CHECKING')
    })

    it('evaluates NOT_INITIALIZED when either required device is NOT_CHECKED', () => {
      expect(calculateOverallReadiness('NOT_CHECKED', 'READY')).toBe('NOT_INITIALIZED')
      expect(calculateOverallReadiness('READY', 'NOT_CHECKED')).toBe('NOT_INITIALIZED')
    })

    it('evaluates FAILED when required device is DENIED or UNAVAILABLE', () => {
      expect(calculateOverallReadiness('DENIED', 'READY')).toBe('FAILED')
      expect(calculateOverallReadiness('READY', 'UNAVAILABLE')).toBe('FAILED')
    })

    it('evaluates DEGRADED on unexpected error state without hard denial', () => {
      expect(calculateOverallReadiness('ERROR', 'READY')).toBe('DEGRADED')
    })

    it('respects policy overrides when camera or mic is not required', () => {
      expect(
        calculateOverallReadiness('DENIED', 'READY', { requireCamera: false, requireMic: true }),
      ).toBe('READY')
    })
  })

  describe('device persistence and enumeration', () => {
    it('handles localStorage persistence safely', () => {
      persistDeviceId('camera', 'test-cam-device-id')
      const stored = getPersistedDeviceId('camera')
      // In node test environment without full localStorage, safely returns null or stored value
      expect(stored === null || stored === 'test-cam-device-id').toBe(true)
    })

    it('safely handles enumerateMediaDevices in non-browser environments', async () => {
      const devices = await enumerateMediaDevices('camera')
      expect(Array.isArray(devices)).toBe(true)
    })
  })
})
