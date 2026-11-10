/**
 * Phase 1C: Native Security Agent IPC Bridge.
 *
 * Provides narrow, typed IPC commands to interact with the AssessX Security Agent,
 * Windows Service lifecycle, Named Pipe communication, compliance evaluation,
 * component integrity checks, tamper event logging, and recovery coordination.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  ComplianceReport,
  IntegrityReport,
  RecoveryStatus,
  SecurityAgentStatus,
  TamperEvent,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Query status of Security Agent service or daemon. */
export function getSecurityAgentStatus(): Promise<SecurityAgentStatus> {
  if (!isTauri()) {
    return Promise.resolve({
      serviceName: 'AssessXSecurityAgent',
      displayName: 'AssessX Native Security Agent (Mock)',
      state: 'Running',
      isDaemonMode: true,
      pid: 12345,
      uptimeSeconds: 3600,
      message: 'Running in mock browser development mode.',
    })
  }
  return invoke<SecurityAgentStatus>('get_security_agent_status')
}

/** Start the Security Agent in safe in-process daemon mode. */
export function startSecurityAgentDaemon(): Promise<SecurityAgentStatus> {
  if (!isTauri()) {
    return Promise.resolve({
      serviceName: 'AssessXSecurityAgent',
      displayName: 'AssessX Native Security Agent',
      state: 'Running',
      isDaemonMode: true,
      pid: 12345,
      uptimeSeconds: 1,
      message: 'Started in mock daemon mode.',
    })
  }
  return invoke<SecurityAgentStatus>('start_security_agent_daemon')
}

/** Stop the in-process daemon. */
export function stopSecurityAgentDaemon(): Promise<SecurityAgentStatus> {
  if (!isTauri()) {
    return Promise.resolve({
      serviceName: 'AssessXSecurityAgent',
      displayName: 'AssessX Native Security Agent',
      state: 'Stopped',
      isDaemonMode: false,
      pid: null,
      uptimeSeconds: 0,
      message: 'Stopped mock daemon mode.',
    })
  }
  return invoke<SecurityAgentStatus>('stop_security_agent_daemon')
}

/** Install Windows Service via SCM (Administrator required). */
export function installSecurityAgentService(): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve('Mock: Windows Service registered with SCM.')
  }
  return invoke<string>('install_security_agent_service')
}

/** Uninstall Windows Service from SCM (Administrator required). */
export function uninstallSecurityAgentService(): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve('Mock: Windows Service removed from SCM.')
  }
  return invoke<string>('uninstall_security_agent_service')
}

/** Evaluate device compliance policy v1.0. */
export function getDeviceComplianceReport(): Promise<ComplianceReport> {
  if (!isTauri()) {
    return Promise.resolve({
      evaluated_at: Date.now().toString(),
      policy_version: '1.0.0',
      overall_status: 'COMPLIANT',
      total_rules: 7,
      passed_rules: 7,
      failed_rules: 0,
      warning_rules: 0,
      results: [
        {
          rule_id: 'RULE_OS_COMPATIBILITY',
          title: 'Windows OS Version & Build Compatibility',
          category: 'OPERATING_SYSTEM',
          status: 'PASS',
          severity: 'HIGH',
          observed_value: 'Windows 11 Pro (Build 22631)',
          expected_value: 'Windows 10/11 Compatible',
          remediation: null,
        },
        {
          rule_id: 'RULE_SECURE_BOOT',
          title: 'UEFI Secure Boot Enforcement',
          category: 'FIRMWARE',
          status: 'PASS',
          severity: 'MEDIUM',
          observed_value: 'Enabled',
          expected_value: 'Enabled',
          remediation: null,
        },
        {
          rule_id: 'RULE_HYPERVISOR_RESTRICTION',
          title: 'Physical Bare-Metal Execution',
          category: 'ENVIRONMENT',
          status: 'PASS',
          severity: 'MEDIUM',
          observed_value: 'Bare-metal hardware',
          expected_value: 'Physical Hardware',
          remediation: null,
        },
      ],
    })
  }
  return invoke<ComplianceReport>('get_device_compliance_report')
}

/** Compute cryptographic SHA-256 integrity digests of critical files. */
export function verifyComponentIntegrity(): Promise<IntegrityReport> {
  if (!isTauri()) {
    return Promise.resolve({
      evaluated_at: Date.now().toString(),
      overall_valid: true,
      components: [
        {
          component_name: 'AssessX Desktop Executable',
          file_path: 'C:\\Program Files\\AssessX\\AssessX.exe',
          expected_sha256: null,
          actual_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          status: 'VALID',
        },
        {
          component_name: 'Cryptographic Device Identity File',
          file_path: 'C:\\Users\\Mock\\AppData\\Roaming\\AssessX\\device_identity.json',
          expected_sha256: null,
          actual_sha256: 'f4b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b866',
          status: 'VALID',
        },
      ],
    })
  }
  return invoke<IntegrityReport>('verify_component_integrity')
}

/** Retrieve recorded tamper detection events. */
export function getAgentTamperEvents(): Promise<TamperEvent[]> {
  if (!isTauri()) {
    return Promise.resolve([])
  }
  return invoke<TamperEvent[]>('get_agent_tamper_events')
}

/** Send periodic heartbeat signal to Security Agent watchdog. */
export function sendAgentHeartbeat(sessionId?: string): Promise<boolean> {
  if (!isTauri()) {
    return Promise.resolve(true)
  }
  return invoke<boolean>('send_agent_heartbeat', { sessionId: sessionId ?? null })
}

/** Flush offline queued events to the backend. */
export function flushSecurityAgentEvents(backendUrl: string, authToken?: string): Promise<number> {
  if (!isTauri()) {
    return Promise.resolve(0)
  }
  return invoke<number>('flush_security_agent_events', {
    backendUrl,
    authToken: authToken ?? null,
  })
}

/** Query recovery status and restart limits. */
export function getAgentRecoveryStatus(): Promise<RecoveryStatus> {
  if (!isTauri()) {
    return Promise.resolve({
      restart_count: 0,
      max_restarts: 3,
      cooldown_seconds: 600,
      lockout_active: false,
      last_restart_timestamp: null,
    })
  }
  return invoke<RecoveryStatus>('get_agent_recovery_status')
}

/** Reset recovery lockout state (Admin action). */
export function resetAgentRecovery(): Promise<boolean> {
  if (!isTauri()) {
    return Promise.resolve(true)
  }
  return invoke<boolean>('reset_agent_recovery')
}

