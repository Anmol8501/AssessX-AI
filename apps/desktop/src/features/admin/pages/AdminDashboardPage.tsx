import { Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, StatCard, StatusBadge } from '@/components/ui'
import { APP_VERSION } from '@/config/app'
import { useCurrentUser } from '@/features/session'
import { API_BASE_URL } from '@/lib/api'
import { useUsers } from '../useUsers'

export function AdminDashboardPage() {
  const user = useCurrentUser()
  const users = useUsers()

  const counts =
    users.status === 'ready'
      ? {
          users: users.users.length,
          candidates: users.users.filter((u) => u.role === 'CANDIDATE').length,
        }
      : null

  return (
    <>
      <PageHeader title={`Welcome back, ${user.name}`} description="Overview of your assessments, candidates and platform status." />

      {/* Assessments and sessions have no data source until Phase 2/4; StatCard renders a dash for null. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Users" value={counts?.users ?? null} hint={users.status === 'error' ? 'Unavailable' : 'All accounts'} />
        <StatCard label="Candidates" value={counts?.candidates ?? null} hint={users.status === 'error' ? 'Unavailable' : 'Candidate accounts'} />
        <StatCard label="Assessments" value={null} hint="Available in Phase 2" />
        <StatCard label="Active sessions" value={null} hint="Available in Phase 4" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Accounts" description="Users who can sign in to this AssessX instance." />
          {users.status === 'loading' && <LoadingState title="Loading accounts…" />}
          {users.status === 'error' && <ErrorState title="Could not load accounts" description={users.message} />}
          {users.status === 'ready' &&
            (users.users.length === 0 ? (
              <EmptyState title="No accounts yet" />
            ) : (
              <ul className="divide-line divide-y">
                {users.users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-4 px-5 py-3 text-[13.5px]">
                    <div className="min-w-0">
                      <p className="text-ink truncate font-medium">{u.name}</p>
                      <p className="text-ink-subtle truncate text-[12.5px]">
                        {u.email}
                        {u.identifier && <span className="font-mono"> · {u.identifier}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge tone={u.role === 'ADMIN' ? 'accent' : 'neutral'}>{u.role === 'ADMIN' ? 'Administrator' : 'Candidate'}</StatusBadge>
                      {!u.isActive && <StatusBadge tone="warn">Inactive</StatusBadge>}
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </Card>

        <Card>
          <CardHeader title="Platform status" />
          <CardBody>
            <dl className="space-y-3 text-[13.5px]">
              <StatusRow label="Application" value={`v${APP_VERSION}`} tone="ok" />
              <StatusRow label="Authentication" value="Backend session" tone="ok" />
              <StatusRow
                label="API"
                value={users.status === 'error' ? 'Unreachable' : users.status === 'loading' ? 'Checking…' : 'Connected'}
                tone={users.status === 'error' ? 'danger' : users.status === 'loading' ? 'neutral' : 'ok'}
              />
            </dl>
            <p className="text-ink-subtle mt-4 truncate font-mono text-[11.5px]" title={API_BASE_URL}>
              {API_BASE_URL}
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd>
        <StatusBadge tone={tone} dot>
          {value}
        </StatusBadge>
      </dd>
    </div>
  )
}
