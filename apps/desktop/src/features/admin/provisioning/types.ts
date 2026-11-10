/**
 * TypeScript interfaces for Phase 1A Windows Provisioning & Readiness IPC and API.
 * Matches camelCase serialization from Rust submodules and backend device endpoints.
 */

export interface WindowsCompatibilityReport {
  platform: string
  edition: string
  displayVersion: string
  buildNumber: string
  ubr: number
  architecture: string
  compatibility: 'SUPPORTED' | 'WARNING' | 'UNSUPPORTED'
  kioskSupported: boolean
  summary: string
  warnings: string[]
}

export interface CpuInfo {
  model: string
  logicalCores: number
  status: 'PASS' | 'WARNING' | 'FAIL'
  message: string
}

export interface MemoryInfo {
  totalGb: number
  availableGb: number
  percentUsed: number
  status: 'PASS' | 'WARNING' | 'FAIL'
  message: string
}

export interface StorageInfo {
  systemDrive: string
  totalGb: number
  freeGb: number
  status: 'PASS' | 'WARNING' | 'FAIL'
  message: string
}

export interface DisplayInfo {
  monitorCount: number
  primaryResolution: string
  status: 'PASS' | 'WARNING' | 'FAIL'
  message: string
}

export interface HardwareReadinessReport {
  cpu: CpuInfo
  memory: MemoryInfo
  storage: StorageInfo
  display: DisplayInfo
  overallStatus: 'PASS' | 'WARNING' | 'FAIL'
  summary: string
}

export interface SecurityCheckItem {
  name: string
  status: 'PASS' | 'WARNING' | 'FAIL' | 'UNKNOWN'
  value: string
  details: string
}

export interface WindowsSecurityReport {
  secureBoot: SecurityCheckItem
  tpm: SecurityCheckItem
  firewall: SecurityCheckItem
  antivirus: SecurityCheckItem
  overallStatus: 'PASS' | 'WARNING' | 'FAIL'
  summary: string
}

export interface PrivilegeStatusReport {
  isElevated: boolean
  userName: string
  privilegeLevel: 'ADMINISTRATOR' | 'STANDARD_USER'
  canProvisionKiosk: boolean
  summary: string
}

export interface DeviceIdentity {
  deviceId: string
  createdAt: string
  hostname: string
  platform: string
  isRegistered: boolean
  registrationToken: string | null
}

export interface CandidateAccountStatus {
  accountName: string
  exists: boolean
  isStandardUser: boolean
  isAdministrator: boolean
  status: 'READY' | 'NEEDS_PROVISIONING' | 'WARNING_IS_ADMIN' | 'NOT_FOUND'
  message: string
}

export interface ProvisioningStep {
  stepNumber: number
  title: string
  description: string
  command: string | null
  requiresElevation: boolean
  isReversible: boolean
}

export interface ProvisioningPlan {
  targetAccount: string
  currentStatus: CandidateAccountStatus
  recommendedAction: string
  steps: ProvisioningStep[]
  requiresAdminApproval: boolean
  generatedAt: string
}

export interface ConfigValidationCheck {
  name: string
  status: 'PASS' | 'WARNING' | 'FAIL'
  details: string
}

export interface ConfigurationValidationReport {
  checks: ConfigValidationCheck[]
  overallStatus: 'READY' | 'READY_WITH_WARNINGS' | 'NOT_READY'
  summary: string
}

export interface InstallationDiagnosticReport {
  diagnosticId: string
  timestamp: string
  deviceIdentity: DeviceIdentity
  compatibility: WindowsCompatibilityReport
  hardware: HardwareReadinessReport
  security: WindowsSecurityReport
  account: CandidateAccountStatus
  validation: ConfigurationValidationReport
  overallStatus: 'PASS' | 'WARNING' | 'FAIL'
  summary: string
  warnings: string[]
  failures: string[]
}

export interface JournalEntry {
  entryId: string
  timestamp: string
  operation: string
  targetResource: string
  previousState: string
  newState: string
  rollbackCommand: string | null
  isReversible: boolean
  status: 'PLANNED' | 'EXECUTED' | 'REVERSED' | 'FAILED'
}

export interface ChangeJournal {
  entries: JournalEntry[]
}

export interface FullDeviceReadinessScan {
  compatibility: WindowsCompatibilityReport
  hardware: HardwareReadinessReport
  security: WindowsSecurityReport
  privileges: PrivilegeStatusReport
  identity: DeviceIdentity
  overallReadiness: 'READY' | 'READY_WITH_WARNINGS' | 'NOT_READY'
  timestamp: string
}

export interface BackendDeviceRecord {
  id: string
  device_identifier: string
  hostname: string
  platform: string
  os_edition: string | null
  os_build: string | null
  status: string
  last_seen_at: string
  registered_by_id: string | null
  created_at: string
}
