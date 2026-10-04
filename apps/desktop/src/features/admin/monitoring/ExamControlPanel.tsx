import { useState } from 'react'
import { LockIcon } from '@/components/icons'
import { Button, ConfirmDialog, StatusBadge } from '@/components/ui'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import type { MonitoringSession } from './types'

type Action = 'hold' | 'release' | 'end'

/**
 * Exam control for one running exam: the server's tab-switch count, and Lock / Unlock / End exam.
 *
 * Lock freezes the exam (the candidate sees a lock screen, cannot answer, and the clock keeps
 * running); Unlock lets them continue; End exam submits the answers saved so far. Every action is
 * audited. The wall updates from the live connection, so this panel needs no state of its own beyond
 * the dialogs.
 */
export function ExamControlPanel({ session }: { session: MonitoringSession }) {
  const api = useApi()
  const [dialog, setDialog] = useState<Action | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const running = session.attemptStatus === 'IN_PROGRESS'
  const warningsUsed = Math.min(session.tabSwitches, session.tabSwitchLimit - 1)

  const run = async (action: Action) => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/v1/admin/attempts/${session.attemptId}/${action}`, {
        method: 'POST',
        body: action === 'hold' ? { note: note.trim() || null } : {},
      })
      setDialog(null)
      setNote('')
    } catch (err) {
      setError(describeError(err, 'Could not change the exam.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border-line mt-4 rounded-md border p-3" aria-label="Exam control">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px]">
          <p className="text-ink font-semibold">Exam control</p>
          <p className="text-ink-muted">
            Tab switches: <span className="text-ink tabular-nums">{session.tabSwitches}</span> · warnings used{' '}
            <span className="tabular-nums">
              {warningsUsed} of {session.tabSwitchLimit - 1}
            </span>
            {' · '}locks automatically on switch {session.tabSwitchLimit}
          </p>
        </div>
        {session.onHold && (
          <StatusBadge tone="danger" dot>
            {session.holdReason === 'TAB_SWITCH_LIMIT' ? 'Locked: tab switching' : 'Locked by an administrator'}
          </StatusBadge>
        )}
      </div>
      {error && (
        <p className="bg-danger-soft text-danger mt-2 rounded-md px-3 py-2 text-[12.5px]" role="alert">
          {error}
        </p>
      )}
      {running && (
        <div className="mt-3 flex flex-wrap gap-2">
          {session.onHold ? (
            <Button size="sm" onClick={() => void run('release')} loading={busy}>
              Unlock exam
            </Button>
          ) : (
            <Button size="sm" variant="danger" leadingIcon={<LockIcon />} onClick={() => setDialog('hold')}>
              Lock exam
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setDialog('end')}>
            End exam
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'hold'}
        title={`Lock ${session.candidateName}'s exam?`}
        description="The candidate sees a lock screen and cannot answer until you unlock it. Their answers are kept and the clock keeps running."
        confirmLabel="Lock exam"
        confirmVariant="danger"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run('hold')}
      >
        <label className="text-ink mt-3 block text-[13px] font-medium" htmlFor="hold-note">
          Note for administrators (optional)
        </label>
        <textarea
          id="hold-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What you saw. Never shown to the candidate."
          className="border-line-strong bg-card text-ink focus:border-accent mt-1 w-full rounded-md border px-2 py-1.5 text-[13px] focus:outline-none"
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'end'}
        title={`End ${session.candidateName}'s exam?`}
        description="The exam ends now and the answers saved so far are submitted and graded. This cannot be undone."
        confirmLabel="End exam"
        confirmVariant="danger"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => void run('end')}
      />
    </section>
  )
}
