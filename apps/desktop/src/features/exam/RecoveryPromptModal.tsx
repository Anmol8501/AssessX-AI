import React, { useState } from 'react'
import type { CrashRecoverySessionInfo } from './sessionContinuity'

interface RecoveryPromptModalProps {
  recoveryInfo: CrashRecoverySessionInfo
  onResume: () => void
  onDismiss: () => void
}

export const RecoveryPromptModal: React.FC<RecoveryPromptModalProps> = ({
  recoveryInfo,
  onResume,
  onDismiss,
}) => {
  const [resuming, setResuming] = useState(false)

  const handleResume = async () => {
    setResuming(true)
    try {
      await onResume()
    } finally {
      setResuming(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      data-testid="recovery-prompt-modal"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-w-md w-full p-6 text-slate-800 dark:text-slate-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold">Unfinished Examination Detected</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Session continuity recovery available
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          The AssessX desktop shell detected an unexpected application exit during an ongoing examination attempt. Your progress and answers were saved in local encrypted storage.
        </p>

        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3 text-xs mb-5 space-y-1.5 border border-slate-200/80 dark:border-slate-700/60">
          <div className="flex justify-between">
            <span className="text-slate-500">Candidate:</span>
            <span className="font-mono font-medium">{recoveryInfo.candidateAccount}</span>
          </div>
          {recoveryInfo.attemptId && (
            <div className="flex justify-between">
              <span className="text-slate-500">Attempt ID:</span>
              <span className="font-mono text-[11px] truncate max-w-[200px]">{recoveryInfo.attemptId}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500">Recovery Attempt:</span>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {recoveryInfo.restartCount} of 3 allowable
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={handleResume}
            disabled={resuming}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {resuming ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Resuming Session...</span>
              </>
            ) : (
              <span>Resume Examination</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

