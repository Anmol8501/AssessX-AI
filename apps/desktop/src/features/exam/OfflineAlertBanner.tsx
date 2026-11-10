import React, { useEffect, useState } from 'react'

export const OfflineAlertBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false))

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      role="status"
      className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 text-amber-900 dark:text-amber-200 transition-all duration-300"
      data-testid="offline-alert-banner"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-xs sm:text-sm">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="font-medium">
            Working Offline: Your answers are encrypted and protected locally. They will sync automatically when connection restores.
          </span>
        </div>
        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-200 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 uppercase tracking-wider shrink-0">
          Local Storage Active
        </span>
      </div>
    </div>
  )
}

