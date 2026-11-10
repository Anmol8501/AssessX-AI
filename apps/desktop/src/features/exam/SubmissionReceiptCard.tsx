import { useState } from 'react'
import { ShieldIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'
import type { SubmissionReceiptResponse } from './submissionClosure'

export interface SubmissionReceiptCardProps {
  receipt: SubmissionReceiptResponse
  onContinue?: () => void
  continueLabel?: string
}

export function SubmissionReceiptCard({
  receipt,
  onContinue,
  continueLabel = 'Return to My Exams',
}: SubmissionReceiptCardProps) {
  const [copiedId, setCopiedId] = useState(false)
  const [copiedHash, setCopiedHash] = useState(false)

  const copyReceiptId = async () => {
    try {
      await navigator.clipboard.writeText(receipt.receipt_id)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    } catch {
      // fallback
    }
  }

  const copyHash = async () => {
    try {
      await navigator.clipboard.writeText(receipt.snapshot_hash)
      setCopiedHash(true)
      setTimeout(() => setCopiedHash(false), 2000)
    } catch {
      // fallback
    }
  }

  const formattedDate = new Date(receipt.submitted_at).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  return (
    <Card className="w-full max-w-2xl border border-line bg-card shadow-lg">
      <CardHeader
        title="Official Submission Receipt"
        description="Phase 3C authoritative submission record with cryptographic answer snapshot verification."
        actions={
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-ok-soft/30 text-ok border border-ok/30">
            <ShieldIcon className="text-sm" />
            <span>Verified Snapshot</span>
          </div>
        }
      />

      <CardBody className="space-y-6">
        {/* Receipt ID highlight banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-surface border border-line">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Authoritative Receipt ID
            </span>
            <p className="mt-0.5 text-base sm:text-lg font-mono font-bold text-ink">
              {receipt.receipt_id}
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={copyReceiptId}
            className="shrink-0 text-xs"
          >
            {copiedId ? 'Copied ID!' : 'Copy Receipt ID'}
          </Button>
        </div>

        {/* Examination & Candidate metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 rounded-lg border border-line bg-card">
            <span className="text-ink-subtle font-medium">Examination Title</span>
            <p className="mt-1 font-semibold text-ink text-sm">{receipt.examination_title}</p>
          </div>

          <div className="p-3 rounded-lg border border-line bg-card">
            <span className="text-ink-subtle font-medium">Candidate Name</span>
            <p className="mt-1 font-semibold text-ink text-sm">{receipt.candidate_name}</p>
          </div>

          <div className="p-3 rounded-lg border border-line bg-card">
            <span className="text-ink-subtle font-medium">Submission Timestamp</span>
            <p className="mt-1 font-medium text-ink">{formattedDate}</p>
          </div>

          <div className="p-3 rounded-lg border border-line bg-card">
            <span className="text-ink-subtle font-medium">Submission Trigger</span>
            <p className="mt-1 font-medium text-ink">
              {receipt.submission_type === 'AUTOMATIC_TIMEOUT'
                ? 'Automatic (Timer Expired)'
                : 'Manual (Candidate Confirmed)'}
            </p>
          </div>

          <div className="p-3 rounded-lg border border-line bg-card">
            <span className="text-ink-subtle font-medium">Questions Answered</span>
            <p className="mt-1 font-semibold text-ink">
              {receipt.total_answered} of {receipt.total_questions} answered
            </p>
          </div>

          <div className="p-3 rounded-lg border border-line bg-card">
            <span className="text-ink-subtle font-medium">Lifecycle Status</span>
            <p className="mt-1 font-semibold text-ok uppercase">{receipt.status}</p>
          </div>
        </div>

        {/* Cryptographic SHA-256 Hash box */}
        <div className="space-y-1.5 p-3.5 rounded-lg border border-line bg-surface/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <ShieldIcon className="text-sm text-blue-500" />
              <span>Canonical Answer Snapshot SHA-256 Hash</span>
            </div>
            <button
              type="button"
              onClick={copyHash}
              className="text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium cursor-pointer"
            >
              {copiedHash ? 'Copied Hash!' : 'Copy Hash'}
            </button>
          </div>

          <p className="text-[11.5px] font-mono break-all text-ink-subtle bg-card p-2 rounded border border-line select-all">
            {receipt.snapshot_hash}
          </p>
          <span className="text-[10.5px] text-ink-subtle block">
            This SHA-256 digest deterministically seals your response payload at commit time.
          </span>
        </div>

        {/* Action button */}
        {onContinue && (
          <div className="flex justify-end pt-2 border-t border-line">
            <Button size="sm" onClick={onContinue}>
              {continueLabel}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
