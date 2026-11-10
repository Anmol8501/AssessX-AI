import { useMemo, useState } from 'react'
import { CameraIcon, MonitoringIcon, RefreshIcon } from '@/components/icons'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { CandidateDetailView } from './CandidateDetailView'
import { CandidateMonitoringGrid } from './CandidateMonitoringGrid'
import { filterMonitoringSessions, type MonitoringStatusFilter } from './filters'
import { useMonitoring } from './useMonitoring'
import type { MonitoringSession } from './types'

/**
 * The admin live monitoring wall (Phase 4C).
 *
 * Shows every candidate currently in an active proctored exam, their factual device/session state,
 * and — when a candidate is opened — their live video and recent proctoring events. Nothing is
 * interpreted or scored: this is technical monitoring, not AI. State arrives over a WebSocket with
 * automatic reconnect; the database (via REST) stays authoritative, so a reconnect reconciles.
 */
export function LiveMonitoringPage() {
  const [selectedExamId, setSelectedExamId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<MonitoringStatusFilter>('ALL')

  const { status, error, sessions, exams, summary, connection, reload, signaling } = useMonitoring(
    selectedExamId || null,
  )
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null)
  const open = sessions.find((s) => s.attemptId === openAttemptId) ?? null

  const filteredSessions = useMemo(
    () => filterMonitoringSessions(sessions, search, statusFilter),
    [sessions, search, statusFilter],
  )

  const selectedExam = exams.find((e) => e.assessmentId === selectedExamId) ?? null

  const connectionBadge = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={reload} leadingIcon={<RefreshIcon />}>
        Refresh
      </Button>
      {connection === 'connected' ? (
        <StatusBadge tone="ok" dot>
          Live
        </StatusBadge>
      ) : connection === 'reconnecting' ? (
        <StatusBadge tone="warn" dot>
          Reconnecting…
        </StatusBadge>
      ) : (
        <StatusBadge tone="danger" dot>
          Live updates disconnected
        </StatusBadge>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Live Monitoring"
        description="Candidates currently taking a proctored exam."
        actions={connectionBadge}
      />

      {exams.length > 0 && (
        <Card className="mb-4 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="monitoring-exam-select" className="text-ink-subtle text-[12.5px] font-medium">
                Examination:
              </label>
              <select
                id="monitoring-exam-select"
                value={selectedExamId}
                onChange={(e) => setSelectedExamId(e.target.value)}
                className="border-line bg-surface text-ink rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              >
                <option value="">All active examinations ({exams.length})</option>
                {exams.map((exam) => (
                  <option key={exam.assessmentId} value={exam.assessmentId}>
                    {exam.title} ({exam.activeSessions} active / {exam.totalAssigned} assigned)
                  </option>
                ))}
              </select>
            </div>

            {selectedExam && (
              <div className="text-ink-subtle flex flex-wrap items-center gap-4 text-[12px]">
                <span>
                  Status: <strong className="text-ink">{selectedExam.status}</strong>
                </span>
                <span>
                  Assigned: <strong className="text-ink">{selectedExam.totalAssigned}</strong>
                </span>
                <span>
                  Submitted: <strong className="text-ink">{selectedExam.submittedCount}</strong>
                </span>
                <span>
                  Interrupted: <strong className="text-warn">{selectedExam.interruptedCount}</strong>
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {status === 'loading' ? (
        <Card>
          <LoadingState title="Loading active sessions…" />
        </Card>
      ) : status === 'error' ? (
        <Card>
          <ErrorState
            title="Unable to load live monitoring sessions"
            description={error ?? undefined}
            onRetry={reload}
          />
        </Card>
      ) : sessions.length === 0 ? (
        <Card>
          <EmptyState
            title="No active candidates"
            description={
              selectedExamId
                ? 'There are currently no candidates in active proctored sessions for this examination.'
                : 'There are currently no candidates in active proctored examinations.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Summary
            active={summary.activeSessions}
            cameras={summary.camerasReady}
            cameraIssues={summary.cameraIssues}
            micIssues={summary.microphoneIssues}
            onHold={summary.onHoldCount}
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              type="search"
              placeholder="Search candidate name, ID, or exam…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-line bg-card text-ink placeholder:text-ink-subtle w-full max-w-xs rounded-md border px-3 py-1.5 text-[13px] outline-none focus:border-accent"
              aria-label="Search active candidates"
            />
            <div className="flex items-center gap-2">
              <label htmlFor="monitoring-status-filter" className="text-ink-subtle text-[12.5px]">
                Filter:
              </label>
              <select
                id="monitoring-status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as MonitoringStatusFilter)}
                className="border-line bg-card text-ink rounded-md border px-2.5 py-1.5 text-[13px] outline-none focus:border-accent"
              >
                <option value="ALL">All statuses ({sessions.length})</option>
                <option value="CONNECTED">Connected</option>
                <option value="INTERRUPTED">Interrupted / On Hold</option>
                <option value="CAMERA_ISSUE">Camera issues</option>
                <option value="MIC_ISSUE">Microphone issues</option>
                <option value="FULLSCREEN_EXIT">Exited fullscreen</option>
              </select>
            </div>
          </div>

          {filteredSessions.length === 0 ? (
            <Card>
              <EmptyState
                title="No matching candidates"
                description="Try clearing the search query or changing the status filter."
              />
            </Card>
          ) : (
            <CandidateMonitoringGrid
              sessions={filteredSessions}
              connection={connection}
              onOpen={(session: MonitoringSession) => setOpenAttemptId(session.attemptId)}
            />
          )}
        </div>
      )}

      {open && (
        <CandidateDetailView
          session={open}
          connection={connection}
          signaling={signaling}
          onClose={() => setOpenAttemptId(null)}
        />
      )}
    </>
  )
}

function Summary({
  active,
  cameras,
  cameraIssues,
  micIssues,
  onHold,
}: {
  active: number
  cameras: number
  cameraIssues: number
  micIssues: number
  onHold: number
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <Stat label="Active sessions" value={active} icon={<MonitoringIcon />} />
      <Stat label="Cameras connected" value={cameras} icon={<CameraIcon />} tone="ok" />
      <Stat label="Camera issues" value={cameraIssues} tone={cameraIssues > 0 ? 'warn' : 'neutral'} />
      <Stat label="Microphone issues" value={micIssues} tone={micIssues > 0 ? 'warn' : 'neutral'} />
      <Stat label="Interrupted / Hold" value={onHold} tone={onHold > 0 ? 'warn' : 'neutral'} />
    </div>
  )
}

function Stat({ label, value, icon, tone = 'neutral' }: { label: string; value: number; icon?: React.ReactNode; tone?: 'ok' | 'warn' | 'neutral' }) {
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3">
        {icon && (
          <span className={tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-ink-subtle'}>{icon}</span>
        )}
        <div>
          <div className="text-ink text-[20px] font-semibold tabular-nums">{value}</div>
          <div className="text-ink-subtle text-[12px]">{label}</div>
        </div>
      </div>
    </Card>
  )
}
