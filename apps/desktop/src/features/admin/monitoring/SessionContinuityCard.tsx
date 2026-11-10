import React, { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'
import { tokenStorage } from '@/features/session'
import type { AttemptContinuitySummary } from '@/features/exam/sessionContinuity'

interface SessionContinuityCardProps {
  attemptId: string
  className?: string
}

export const SessionContinuityCard: React.FC<SessionContinuityCardProps> = ({
  attemptId,
  className = '',
}) => {
  const [data, setData] = useState<AttemptContinuitySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContinuity = useCallback(async () => {
    try {
      setLoading(true)
      const token = tokenStorage.get()
      const summary = await apiRequest<AttemptContinuitySummary>(
        `/api/v1/admin/attempts/${attemptId}/continuity`,
        { token },
      )
      setData(summary)
      setError(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load continuity metrics')
    } finally {
      setLoading(false)
    }
  }, [attemptId])

  useEffect(() => {
    void fetchContinuity()
    const interval = setInterval(() => {
      void fetchContinuity()
    }, 15000)

    return () => {
      clearInterval(interval)
    }
  }, [fetchContinuity])

  if (loading && !data) {
    return (
      <div className={`p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse ${className}`}>
        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded w-1/3 mb-3" />
        <div className="h-8 bg-slate-100 dark:bg-slate-800/50 rounded w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={`p-4 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50/50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 text-xs ${className}`}>
        <span className="font-semibold">Continuity Telemetry:</span> {error || 'No telemetry reported'}
      </div>
    )
  }

  return (
    <div
      className={`p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm text-slate-800 dark:text-slate-100 ${className}`}
      data-testid="session-continuity-card"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Session Continuity & Heartbeat</span>
          {data.is_dropped_out ? (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-300 dark:border-rose-800 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
              DROPPED OUT (&gt;60s)
            </span>
          ) : (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              CONNECTED
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchContinuity()}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Heartbeat Latency</div>
          <div className="font-medium text-sm mt-0.5">
            {data.seconds_since_heartbeat !== null ? `${data.seconds_since_heartbeat}s ago` : 'Never'}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Device Station</div>
          <div className="font-mono text-xs mt-0.5 truncate" title={data.device_id || 'Unknown'}>
            {data.device_id || 'Unknown'}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Pending Sync Items</div>
          <div className="font-semibold text-sm mt-0.5">
            {data.pending_sync_count}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">Answers Synced</div>
          <div className="font-semibold text-sm mt-0.5 text-blue-600 dark:text-blue-400">
            {data.total_answers_synced}
          </div>
        </div>
      </div>
    </div>
  )
}

