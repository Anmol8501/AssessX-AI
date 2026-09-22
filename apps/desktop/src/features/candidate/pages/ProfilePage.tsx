import { useEffect, useState } from 'react'
import { Card, CardBody, CardHeader, ComingSoon, ErrorState, InfoList, LoadingState, PageHeader } from '@/components/ui'
import { ROLE_LABEL, useApi, type Role } from '@/features/session'
import { ApiError } from '@/lib/api'

interface CandidateProfileDto {
  id: string
  name: string
  email: string
  role: Role
  roll_number: string | null
}

type ProfileState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; profile: CandidateProfileDto }

export function ProfilePage() {
  const api = useApi()
  const [state, setState] = useState<ProfileState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    // Candidate-only endpoint: the backend rejects any other role.
    api<CandidateProfileDto>('/api/v1/candidates/me', { signal: controller.signal })
      .then((profile) => setState({ status: 'ready', profile }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof ApiError ? error.message : 'Could not load your profile.' })
      })
    return () => controller.abort()
  }, [api])

  return (
    <>
      <PageHeader title="Profile" description="Your account details as known to AssessX." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          {state.status === 'loading' && <LoadingState title="Loading your profile…" />}
          {state.status === 'error' && <ErrorState title="Could not load your profile" description={state.message} />}
          {state.status === 'ready' && (
            <CardBody>
              <InfoList
                items={[
                  { label: 'Name', value: state.profile.name },
                  { label: 'University roll number', value: state.profile.roll_number ?? '—' },
                  { label: 'Email', value: state.profile.email },
                  { label: 'Role', value: ROLE_LABEL[state.profile.role] },
                ]}
              />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Identity verification" description="Required before secure exams." />
          <ComingSoon
            layout="inline"
            title="Not available yet"
            description="Identity and system checks are part of the proctoring foundation."
            phase="Phase 4 — Basic Proctoring"
          />
        </Card>
      </div>
    </>
  )
}
