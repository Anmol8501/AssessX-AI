/**
 * The admin-facing Secure Kiosk bridge (Phase 4B.5, Mode B).
 *
 * It only *reads* whether Windows supports Assigned Access kiosk and whether this session already
 * runs as one, and *generates* an administrator provisioning package (Assigned Access XML plus
 * apply/remove scripts) for the admin to review and run on a dedicated exam machine. The app never
 * applies a kiosk configuration and never touches this machine — see
 * `docs/security/WINDOWS-SECURE-KIOSK.md`.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'

export type SecurityMode = 'STANDARD' | 'SECURE_KIOSK'

export interface KioskStatus {
  securityMode: SecurityMode
  windowsEdition: string
  assignedAccessSupported: boolean
  kioskActive: boolean
  summary: string
}

export interface KioskConfig {
  available: boolean
  assignedAccessXml: string
  applyScript: string
  removeScript: string
  notes: string
}

/** True in the packaged desktop app, where the OS can actually be inspected. */
export function kioskAvailable(): boolean {
  return isTauri()
}

export function kioskStatus(): Promise<KioskStatus> {
  return invoke<KioskStatus>('kiosk_status')
}

export function generateKioskConfig(kioskAccount: string, exePath: string): Promise<KioskConfig> {
  return invoke<KioskConfig>('kiosk_generate_config', { kioskAccount, exePath })
}
