import type { MonitoringEvent, MonitoringSession } from './types'

export type MonitoringStatusFilter =
  | 'ALL'
  | 'CONNECTED'
  | 'INTERRUPTED'
  | 'CAMERA_ISSUE'
  | 'MIC_ISSUE'
  | 'FULLSCREEN_EXIT'

export function filterMonitoringSessions(
  sessions: MonitoringSession[],
  search: string,
  statusFilter: MonitoringStatusFilter,
): MonitoringSession[] {
  const q = search.trim().toLowerCase()
  return sessions.filter((s) => {
    if (q) {
      const matchName = s.candidateName.toLowerCase().includes(q)
      const matchRoll = s.candidateRollNumber?.toLowerCase().includes(q) ?? false
      const matchExam = s.assessmentTitle.toLowerCase().includes(q)
      if (!matchName && !matchRoll && !matchExam) return false
    }
    switch (statusFilter) {
      case 'CONNECTED':
        return s.candidateConnected && !s.onHold
      case 'INTERRUPTED':
        return s.onHold || (s.interruptionCount ?? 0) > 0 || !s.candidateConnected
      case 'CAMERA_ISSUE':
        return s.cameraState !== 'READY'
      case 'MIC_ISSUE':
        return s.microphoneState !== 'READY'
      case 'FULLSCREEN_EXIT':
        return s.fullscreen === false
      default:
        return true
    }
  })
}

export function paginateSessions<T>(items: T[], page: number, pageSize = 16): {
  visible: T[]
  pageCount: number
  clampedPage: number
} {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const clampedPage = Math.max(0, Math.min(page, pageCount - 1))
  const start = clampedPage * pageSize
  return {
    visible: items.slice(start, start + pageSize),
    pageCount,
    clampedPage,
  }
}

export function filterMonitoringEvents(
  events: MonitoringEvent[],
  category: string,
  severity: string,
): MonitoringEvent[] {
  return events.filter((e) => {
    if (category !== 'ALL' && e.category !== category) return false
    if (severity !== 'ALL' && (e.severity ?? 'INFO') !== severity) return false
    return true
  })
}

