import { useEffect, useState } from 'react'
import { routes } from '@/app/routes'
import {
  type CrashRecoverySessionInfo,
  getRecoverySessionState,
} from './sessionContinuity'
import { RecoveryPromptModal } from './RecoveryPromptModal'

export function RecoveryWatcher() {
  const [recoveryInfo, setRecoveryInfo] = useState<CrashRecoverySessionInfo | null>(null)

  useEffect(() => {
    void getRecoverySessionState().then((state) => {
      if (state && state.crashDetected && (state.attemptId || state.assessmentId)) {
        setRecoveryInfo(state)
      }
    })
  }, [])

  if (!recoveryInfo) return null

  const handleResume = () => {
    const target = recoveryInfo.assessmentId
      ? routes.candidate.attempt(recoveryInfo.assessmentId)
      : routes.candidate.exams

    setRecoveryInfo(null)
    window.location.assign(target)
  }

  const handleDismiss = () => {
    setRecoveryInfo(null)
  }

  return (
    <RecoveryPromptModal
      recoveryInfo={recoveryInfo}
      onResume={handleResume}
      onDismiss={handleDismiss}
    />
  )
}

