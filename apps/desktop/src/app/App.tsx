import { RouterProvider } from 'react-router'
import { authClient, SessionProvider } from '@/features/session'
import { UpdatePrompt } from '@/features/updates/UpdatePrompt'
import { RecoveryWatcher } from '@/features/exam/RecoveryWatcher'
import { router } from './router'

export function App() {
  return (
    <SessionProvider client={authClient}>
      <RouterProvider router={router} />
      <RecoveryWatcher />
      <UpdatePrompt />
    </SessionProvider>
  )
}
