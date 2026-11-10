/**
 * Types for AssessX Native Security Agent & System Integration (Phase 1C).
 */

export type ServiceLifecycleState =
  | 'NotInstalled'
  | 'Stopped'
  | 'Starting'
  | 'Running'
  | 'Degraded'
  | 'Stopping'
  | 'Failed';

export interface SecurityAgentStatus {
  serviceName: string;
  displayName: string;
  state: ServiceLifecycleState;
  isDaemonMode: boolean;
  pid: number | null;
  uptimeSeconds: number;
  message: string;
}

export interface ComplianceRuleResult {
  rule_id: string;
  title: string;
  category: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  observed_value: string;
  expected_value: string;
  remediation: string | null;
}

export interface ComplianceReport {
  evaluated_at: string;
  policy_version: string;
  overall_status: 'COMPLIANT' | 'NON_COMPLIANT' | 'WARNING' | 'UNKNOWN';
  total_rules: number;
  passed_rules: number;
  failed_rules: number;
  warning_rules: number;
  results: ComplianceRuleResult[];
}

export interface ComponentIntegrityResult {
  component_name: string;
  file_path: string;
  expected_sha256: string | null;
  actual_sha256: string | null;
  status: 'VALID' | 'MISMATCH' | 'FILE_NOT_FOUND' | 'UNREADABLE';
}

export interface IntegrityReport {
  evaluated_at: string;
  overall_valid: boolean;
  components: ComponentIntegrityResult[];
}

export interface TamperEvent {
  eventId: string;
  tamperType: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  description: string;
  timestampMs: number;
  details: Record<string, unknown>;
}

export interface RecoveryStatus {
  restart_count: number;
  max_restarts: number;
  cooldown_seconds: number;
  lockout_active: boolean;
  last_restart_timestamp: number | null;
}
