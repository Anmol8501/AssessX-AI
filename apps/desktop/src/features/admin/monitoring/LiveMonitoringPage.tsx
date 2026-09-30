import { useState } from 'react'
import { CameraIcon, MonitoringIcon } from '@/components/icons'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { CandidateDetailView } from './CandidateDetailView'
import { CandidateMonitoringGrid } from './CandidateMonitoringGrid'
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
  const { status, error, sessions, summary, connection, reload, signaling } = useMonitoring()
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null)
  const open = sessions.find((s) => s.attemptId === openAttemptId) ?? null

  const connectionBadge =
    connection === 'connected' ? (
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
    )

  return (
    <>
      <PageHeader
        title="Live Monitoring"
        description="Candidates currently taking a proctored exam."
        actions={connectionBadge}
      />

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
            description="There are currently no candidates in active proctored examinations."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Summary
            active={summary.activeSessions}
            cameras={summary.camerasReady}
            cameraIssues={summary.cameraIssues}
            micIssues={summary.microphoneIssues}
          />
          <CandidateMonitoringGrid
            sessions={sessions}
            connection={connection}
            onOpen={(session: MonitoringSession) => setOpenAttemptId(session.attemptId)}
          />
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

function Summary({ active, cameras, cameraIssues, micIssues }: { active: number; cameras: number; cameraIssues: number; micIssues: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Active sessions" value={active} icon={<MonitoringIcon />} />
      <Stat label="Cameras connected" value={cameras} icon={<CameraIcon />} tone="ok" />
      <Stat label="Camera issues" value={cameraIssues} tone={cameraIssues > 0 ? 'warn' : 'neutral'} />
      <Stat label="Microphone issues" value={micIssues} tone={micIssues > 0 ? 'warn' : 'neutral'} />
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
