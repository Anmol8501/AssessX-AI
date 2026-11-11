import { useEffect } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { RouterProvider } from 'react-router'
import { authClient, SessionProvider } from '@/features/session'
import { UpdatePrompt } from '@/features/updates/UpdatePrompt'
import { RecoveryWatcher } from '@/features/exam/RecoveryWatcher'
import { router } from './router'

export function App() {
  useEffect(() => {
    if (!isTauri()) return
    const ping = () => {
      void invoke('secure_shell_heartbeat').catch(() => undefined)
    }
    ping()
    const timer = window.setInterval(ping, 15_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <SessionProvider client={authClient}>
      <RouterProvider router={router} />
      <RecoveryWatcher />
      <UpdatePrompt />
    </SessionProvider>
  )
}
