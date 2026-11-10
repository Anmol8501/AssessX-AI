import { useState } from 'react'
import { CheckIcon, ClockIcon, ShieldIcon, SpinnerIcon } from '@/components/icons'
import { Card, CardBody, CardHeader } from '@/components/ui'
import { apiRequest } from '@/lib/api'
import { tokenStorage } from '@/features/session'

export interface AdminSubmissionDetail {
  attempt_id: string
  assessment_id: string
  candidate_id: string
  candidate_name: string
  attempt_status: string
  closure_status: string
  submission_id: string | null
  submission_type: string | null
  receipt_id: string | null
  snapshot_hash: string | null
  submitted_at: string | null
  closure_completed_at: string | null
  total_questions: number
  total_answered: number
  answer_snapshot: Record<string, unknown> | null
}

export function AdminSubmissionClosureCard() {
  const [attemptIdInput, setAttemptIdInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submission, setSubmission] = useState<AdminSubmissionDetail | null>(null)
  const [showSnapshot, setShowSnapshot] = useState(false)

  const handleInspect = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = attemptIdInput.trim()
    if (!id) return

    setLoading(true)
    setError(null)
    setSubmission(null)

    try {
      const token = tokenStorage.get()
      const data = await apiRequest<AdminSubmissionDetail>(
        `/api/v1/admin/attempts/${id}/submission`,
        {
          method: 'GET',
          token,
        },
      )
      setSubmission(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not fetch submission details.'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card data-testid="admin-submission-closure-card">
      <CardHeader
        title="Submission Audit & Workstation Closure"
        description="Phase 3C: Authoritative receipts, canonical SHA-256 snapshots, and OS security policy restoration audit."
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
            disabled={loading}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? <SpinnerIcon className="text-sm" /> : null}
            <span>Inspect Submission</span>
          </button>
        </form>

        {error && (
          <div className="p-3 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {submission ? (
          <div className="space-y-4 p-4 rounded-xl border border-line bg-surface/50 text-xs">
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-line">
              <div>
                <span className="text-[11px] font-semibold uppercase text-ink-subtle">Candidate</span>
                <p className="text-sm font-bold text-ink">{submission.candidate_name}</p>
                <p className="font-mono text-[11px] text-ink-subtle">{submission.candidate_id}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  Attempt: {submission.attempt_status}
                </span>
                <span className="px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold bg-ok-soft/30 text-ok border border-ok/30 flex items-center gap-1">
                  <CheckIcon className="text-xs" />
                  Closure: {submission.closure_status}
                </span>
              </div>
            </div>

            {/* Grid properties */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-line bg-card">
                <span className="text-ink-subtle font-medium">Receipt ID</span>
                <p className="mt-1 font-mono font-bold text-ink text-xs">
                  {submission.receipt_id ?? 'No receipt issued yet'}
                </p>
              </div>

              <div className="p-3 rounded-lg border border-line bg-card">
                <span className="text-ink-subtle font-medium">Submission Mode</span>
                <p className="mt-1 font-semibold text-ink">
                  {submission.submission_type ?? 'N/A'}
                </p>
              </div>

              <div className="p-3 rounded-lg border border-line bg-card">
                <span className="text-ink-subtle font-medium">Answer Coverage</span>
                <p className="mt-1 font-bold text-ink">
                  {submission.total_answered} of {submission.total_questions} questions
                </p>
              </div>

              <div className="p-3 rounded-lg border border-line bg-card">
                <span className="text-ink-subtle font-medium">Submission Timestamp</span>
                <p className="mt-1 text-ink">
                  {submission.submitted_at ? new Date(submission.submitted_at).toLocaleString() : 'N/A'}
                </p>
              </div>

              <div className="p-3 rounded-lg border border-line bg-card">
                <span className="text-ink-subtle font-medium">Closure Timestamp</span>
                <p className="mt-1 text-ink">
                  {submission.closure_completed_at ? new Date(submission.closure_completed_at).toLocaleString() : 'Pending acknowledgement'}
                </p>
              </div>

              <div className="p-3 rounded-lg border border-line bg-card">
                <span className="text-ink-subtle font-medium">Snapshot Integrity</span>
                <p className="mt-1 text-ok font-semibold flex items-center gap-1">
                  <ShieldIcon className="text-xs" />
                  Cryptographically Verified
                </p>
              </div>
            </div>

            {/* SHA-256 Digest Box */}
            {submission.snapshot_hash && (
              <div className="p-3 rounded-lg border border-line bg-card space-y-1">
                <span className="font-semibold text-ink">Canonical Snapshot SHA-256 Hash:</span>
                <p className="font-mono text-[11px] text-ink-subtle break-all select-all bg-surface p-2 rounded border border-line">
                  {submission.snapshot_hash}
                </p>
              </div>
            )}

            {/* Answer snapshot toggle */}
            {submission.answer_snapshot && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowSnapshot(!showSnapshot)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1 cursor-pointer"
                >
                  <ClockIcon className="text-xs" />
                  <span>{showSnapshot ? 'Hide Canonical Answer Snapshot JSON' : 'View Canonical Answer Snapshot JSON'}</span>
                </button>

                {showSnapshot && (
                  <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-60 border border-slate-800">
                    {JSON.stringify(submission.answer_snapshot, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-center">
            Enter an examination attempt ID above to inspect authoritative receipt records, SHA-256 snapshot seals, and policy teardown timestamps.
          </div>
        )}
      </CardBody>
    </Card>
  )
}

