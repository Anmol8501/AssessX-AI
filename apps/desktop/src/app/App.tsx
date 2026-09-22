import { RouterProvider } from 'react-router'
import { authClient, SessionProvider } from '@/features/session'
import { router } from './router'

export function App() {
  return (
    <SessionProvider client={authClient}>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
