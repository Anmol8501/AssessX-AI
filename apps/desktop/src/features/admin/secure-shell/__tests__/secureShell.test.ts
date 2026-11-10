import { describe, expect, it } from 'vitest'
import {
  applyKioskConfig,
  checkCrashRecovery,
  enforceFullscreen,
  executeRestoration,
  getDisplayTopology,
  getKioskCapabilities,
  getLifecycleState,
  getShellHealth,
  inspectStartup,
  previewKioskConfig,
  previewRestoration,
  registerStartup,
  releaseFullscreen,
  runStartupValidation,
} from '../secureShell'

describe('Phase 1B: Secure Shell & Examination Startup Bridge', () => {
  it('detects Windows kiosk capabilities (Stage 1)', async () => {
    const report = await getKioskCapabilities()
    expect(report).toBeDefined()
    expect(report.assignedAccess).toBeDefined()
    expect(report.shellLauncher).toBeDefined()
    expect(['ASSIGNED_ACCESS', 'SHELL_LAUNCHER', 'UNSUPPORTED']).toContain(report.recommendedMechanism)
    expect(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'REQUIRES_ADMINISTRATOR']).toContain(report.overallStatus)
  })

  it('previews and applies kiosk configuration with approval gate (Stage 2)', async () => {
    const preview = await previewKioskConfig('AssessXCandidate', 'ASSIGNED_ACCESS')
    expect(preview).toBeDefined()
    expect(preview.plannedSteps.length).toBeGreaterThan(0)
    expect(preview.rollbackSteps.length).toBeGreaterThan(0)

    // Unapproved should fail
    const unapproved = await applyKioskConfig('AssessXCandidate', 'ASSIGNED_ACCESS', undefined, false)
    expect(unapproved.success).toBe(false)
    expect(unapproved.currentState).toBe('ADMIN_APPROVAL_REQUIRED')

    // Approved should succeed
    const approved = await applyKioskConfig('AssessXCandidate', 'ASSIGNED_ACCESS', undefined, true)
    expect(approved.success).toBe(true)
    expect(approved.currentState).toBe('CONFIGURED')
  })

  it('inspects and toggles automatic examination startup (Stage 3)', async () => {
    const inspect = await inspectStartup('AssessXCandidate')
    expect(inspect).toBeDefined()
    expect(inspect.targetAccount).toBe('AssessXCandidate')

    const register = await registerStartup('AssessXCandidate', true)
    expect(register.success).toBe(true)
    expect(register.status).toBe('CONFIGURED')

    const unregister = await registerStartup('AssessXCandidate', false)
    expect(unregister.success).toBe(true)
    expect(unregister.status).toBe('NOT_CONFIGURED')
  })

  it('evaluates display topology and manages fullscreen window (Stage 4)', async () => {
    const topology = await getDisplayTopology()
    expect(topology).toBeDefined()
    expect(topology.monitorCount).toBeGreaterThanOrEqual(1)
    expect(topology.displays.length).toBeGreaterThanOrEqual(1)

    const enforced = await enforceFullscreen()
    expect(enforced).toBe(true)

    const released = await releaseFullscreen()
    expect(released).toBe(true)
  })

  it('tracks session lifecycle and runs pre-flight validation (Stage 5)', async () => {
    const state = await getLifecycleState()
    expect(state).toBeDefined()

    const validation = await runStartupValidation('AssessXCandidate')
    expect(validation).toBeDefined()
    expect(validation.checks.length).toBeGreaterThanOrEqual(5)
    expect(['READY', 'READY_WITH_WARNINGS', 'BLOCKED', 'ERROR']).toContain(validation.overallResult)
    expect(typeof validation.canProceed).toBe('boolean')
  })

  it('inspects crash detection and recovery records (Stage 6)', async () => {
    const crash = await checkCrashRecovery()
    expect(crash).toBeDefined()
    expect(typeof crash.crashDetected).toBe('boolean')
    expect(crash.maxRestartsAllowed).toBe(3)
  })

  it('previews and executes normal-mode restoration (Stage 7)', async () => {
    const preview = await previewRestoration('AssessXCandidate')
    expect(preview).toBeDefined()
    expect(preview.restorationSteps.length).toBeGreaterThan(0)

    // Unconfirmed should fail
    const unconfirmed = await executeRestoration('AssessXCandidate', false)
    expect(unconfirmed.success).toBe(false)

    // Confirmed should succeed
    const confirmed = await executeRestoration('AssessXCandidate', true)
    expect(confirmed.success).toBe(true)
    expect(confirmed.status).toBe('RESTORED')
    expect(confirmed.restoredItems.length).toBeGreaterThan(0)
  })

  it('monitors shell health and responsiveness', async () => {
    const health = await getShellHealth()
    expect(health).toBeDefined()
    expect(['HEALTHY', 'DEGRADED', 'UNRESPONSIVE', 'RECOVERING', 'FAILED']).toContain(health.status)
    expect(health.isResponsive).toBe(true)
  })
})

