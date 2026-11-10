import React from 'react'
import type { SaveState } from './types'

interface SyncStatusBadgeProps {
  status: SaveState | 'idle'
  className?: string
}

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({ status, className = '' }) => {
  if (status === 'idle') {
    return null
  }

  if (status === 'saved') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 ${className}`}
        data-testid="sync-status-saved"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Saved</span>
      </div>
    )
  }

  if (status === 'saving') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border border-blue-200 dark:border-blue-800 ${className}`}
        data-testid="sync-status-saving"
      >
        <svg
          className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span>Saving...</span>
      </div>
    )
  }

  if (status === 'offline_saved') {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800 ${className}`}
        data-testid="sync-status-offline"
        title="Your answers are encrypted on this device and will sync once internet connection is restored."
      >
        <svg
          className="w-3 h-3 text-amber-600 dark:text-amber-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
        <span>Saved locally (offline)</span>
      </div>
    )
  }

  // Error
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800 ${className}`}
      data-testid="sync-status-error"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
      <span>Sync pending (retrying)</span>
    </div>
  )
}

