import { useEffect, useState } from 'react'
import { useApi, type Role } from '@/features/session'
import { ApiError } from '@/lib/api'

export interface UserSummary {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  /** Roll number for candidates, username for administrators. */
  identifier: string | null
}

interface UserDto {
  id: string
  name: string
  email: string
  role: Role
  is_active: boolean
  roll_number: string | null
  username: string | null
}

type UsersState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; users: UserSummary[] }

/** Admin-only user list from `GET /api/v1/users`. */
export function useUsers(): UsersState {
  const api = useApi()
  const [state, setState] = useState<UsersState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    api<UserDto[]>('/api/v1/users', { signal: controller.signal })
      .then((dtos) =>
        setState({
          status: 'ready',
          users: dtos.map((d) => ({
            id: d.id,
            name: d.name,
            email: d.email,
            role: d.role,
            isActive: d.is_active,
            identifier: d.role === 'ADMIN' ? d.username : d.roll_number,
          })),
        }),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof ApiError ? error.message : 'Could not load users.',
        })
      })
    return () => controller.abort()
  }, [api])

  return state
}
