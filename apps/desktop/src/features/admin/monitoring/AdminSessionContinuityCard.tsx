import { useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui'
import { SessionContinuityCard } from './SessionContinuityCard'

export function AdminSessionContinuityCard() {
  const [attemptIdInput, setAttemptIdInput] = useState('')
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null)

  const handleInspect = (e: React.FormEvent) => {
    e.preventDefault()
    if (attemptIdInput.trim()) {
      setActiveAttemptId(attemptIdInput.trim())
    }
  }

  return (
    <Card data-testid="admin-session-continuity-card">
      <CardHeader
        title="Session Continuity & Dropout Monitor"
        description="Phase 3B: Real-time telemetry, periodic heartbeat tracking, and network dropout detection (>60s silence)."
      />
      <CardBody className="space-y-4">
        <form onSubmit={handleInspect} className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Enter Examination Attempt ID (UUID)"
            value={attemptIdInput}
            onChange={(e) => setAttemptIdInput(e.target.value)}
            className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
          />
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Inspect Continuity
          </button>
        </form>

        {activeAttemptId ? (
          <SessionContinuityCard attemptId={activeAttemptId} />
        ) : (
          <div className="p-3 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center">
            Enter an active examination attempt ID above to inspect live candidate heartbeat latency, pending answer syncs, and dropout states.
          </div>
        )}
      </CardBody>
    </Card>
  )
}

