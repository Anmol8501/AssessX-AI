import { useState } from 'react'
import { ShieldIcon } from '@/components/icons'
import { Button, Card, CardHeader, EmptyState, ErrorState, LoadingState, LoadMore, PageHeader, StatusBadge } from '@/components/ui'
import type { StatusTone } from '@/components/ui'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi, usePagedList } from '@/features/session'

interface AlertRow {
  id: string
  created_at: string
  rule: string
  severity: Severity
  group_key: string
  event_count: number
  summary: string
  delivery: string
  acknowledged_at: string | null
}

interface EventRow {
  id: string
  occurred_at: string
  event_type: string
  severity: Severity
  category: string
  request_id: string | null
  actor_id: string | null
  client_ip: string | null
  target_type: string | null
  target_id: string | null
}

interface AuditRow {
  id: string
  seq: number | null
  occurred_at: string
  action: string
  actor_name: string | null
  request_id: string | null
  client_ip: string | null
  details: Record<string, unknown>
}

interface Chain {
  verified: boolean
  rows_checked: number
  broken_at: number[]
  head_seq: number | null
  head_hash: string | null
}

type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
type Tab = 'alerts' | 'events' | 'audit'

const TONE: Record<Severity, StatusTone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warn', CRITICAL: 'danger' }

const when = (iso: string) => new Date(iso).toLocaleString()

/**
 * Security operations for administrators (Phase 8 final, CX-02/11/13): open alerts, recent security events
 * and the audit trail — newest first, one page at a time — plus a check of the audit hash chain. Every view
 * here is itself recorded in the audit trail. Normal proctoring observations never appear here.
 */
export function SecurityPage() {
  const [tab, setTab] = useState<Tab>('alerts')
  return (
    <>
      <PageHeader title="Security" description="Alerts, security events and the tamper-evident audit trail. Viewing them is audited." />
      <div className="mb-4 flex gap-2" role="tablist" aria-label="Security views">
        {(
          [
            ['alerts', 'Alerts'],
            ['events', 'Security events'],
            ['audit', 'Audit trail'],
          ] as const
        ).map(([value, label]) => (
          <Button key={value} size="sm" variant={tab === value ? 'primary' : 'secondary'} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
            {label}
          </Button>
        ))}
      </div>
      {tab === 'alerts' && <Alerts />}
      {tab === 'events' && <Events />}
      {tab === 'audit' && <Audit />}
    </>
  )
}

function Alerts() {
  const api = useApi()
  const [openOnly, setOpenOnly] = useState(true)
  const list = usePagedList<AlertRow>(`/api/v1/admin/security-alerts?open_only=${openOnly}`, 'Could not load alerts.')
  const [busy, setBusy] = useState<string | null>(null)

  async function acknowledge(id: string) {
    setBusy(id)
    try {
      await api(`/api/v1/admin/security-alerts/${id}/acknowledge`, { method: 'POST' })
      await list.reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Alerts"
        description="Raised when a rule's threshold is reached (deduplicated per rule and subject). Configure a webhook to be notified."
        actions={
          <Button size="sm" variant="ghost" onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? 'Show acknowledged too' : 'Open only'}
          </Button>
        }
      />
      <ListBody state={list.state} empty="No alerts." onRetry={() => void list.reload()}>
        {(rows) => (
          <ul className="divide-line divide-y">
            {rows.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 px-5 py-3 text-[13px]">
                <div className="min-w-0">
                  <p className="text-ink font-medium">{a.summary}</p>
                  <p className="text-ink-subtle text-[12px]">
                    {when(a.created_at)} · {a.group_key} · {a.delivery}
                    {a.acknowledged_at ? ` · acknowledged ${when(a.acknowledged_at)}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={TONE[a.severity]}>{a.severity}</StatusBadge>
                  {!a.acknowledged_at && (
                    <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => void acknowledge(a.id)}>
                      Acknowledge
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListBody>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={() => void list.loadMore()} />
    </Card>
  )
}

function Events() {
  const [severity, setSeverity] = useState<Severity | ''>('')
  const list = usePagedList<EventRow>(`/api/v1/admin/security-events${severity ? `?severity=${severity}` : ''}`, 'Could not load security events.')
  return (
    <Card>
      <CardHeader
        title="Security events"
        description="Refused requests, sign-in attacks, socket abuse, integrity and availability problems."
        actions={
          <select
            aria-label="Severity"
            className="border-line-strong bg-card rounded-md border px-2 py-1 text-[13px]"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity | '')}
          >
            <option value="">All severities</option>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        }
      />
      <ListBody state={list.state} empty="No security events." onRetry={() => void list.reload()}>
        {(rows) => (
          <table className="w-full text-left text-[12.5px]">
            <thead className="text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">When</th>
                <th className="py-2 font-medium">Event</th>
                <th className="py-2 font-medium">Severity</th>
                <th className="py-2 font-medium">Address</th>
                <th className="py-2 font-medium">Request</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="text-ink-subtle px-5 py-2 tabular-nums">{when(e.occurred_at)}</td>
                  <td className="text-ink py-2">{e.event_type.replace(/_/g, ' ')}</td>
                  <td className="py-2">
                    <StatusBadge tone={TONE[e.severity]}>{e.severity}</StatusBadge>
                  </td>
                  <td className="text-ink-subtle py-2 font-mono">{e.client_ip ?? '—'}</td>
                  <td className="text-ink-subtle py-2 font-mono">{e.request_id ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ListBody>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={() => void list.loadMore()} />
    </Card>
  )
}

function Audit() {
  const api = useApi()
  const list = usePagedList<AuditRow>('/api/v1/admin/audit-logs', 'Could not load the audit trail.')
  const [chain, setChain] = useState<Chain | null>(null)
  const [checking, setChecking] = useState(false)
  const [chainError, setChainError] = useState<string | null>(null)

  async function verify() {
    setChecking(true)
    setChainError(null)
    try {
      setChain(await api<Chain>('/api/v1/admin/audit-logs/verify'))
    } catch (error) {
      setChainError(describeError(error, 'Could not verify the audit chain.'))
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Audit trail"
        description="Append-only, and hash-chained by the database: any changed, removed or inserted row breaks the chain."
        actions={
          <Button size="sm" variant="secondary" loading={checking} onClick={() => void verify()} leadingIcon={<ShieldIcon />}>
            Verify audit chain
          </Button>
        }
      />
      {chainError && <p className="text-danger px-5 pb-2 text-[12.5px]">{chainError}</p>}
      {chain && (
        <p className={`px-5 pb-3 text-[12.5px] ${chain.verified ? 'text-ok' : 'text-danger'}`} role="status" data-security="chain">
          {chain.verified
            ? `Verified: ${chain.rows_checked} entries, chain head #${chain.head_seq} (${chain.head_hash?.slice(0, 12)}…).`
            : `The chain does not verify — first break at entry #${chain.broken_at[0]}. A critical alert has been raised.`}
        </p>
      )}
      <ListBody state={list.state} empty="No audit entries." onRetry={() => void list.reload()}>
        {(rows) => (
          <ul className="divide-line divide-y">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-2 text-[12.5px]">
                <span className="text-ink-subtle tabular-nums">#{r.seq} · {when(r.occurred_at)}</span>{' '}
                <span className="text-ink font-medium">{r.action.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="text-ink-subtle">
                  {' '}
                  · {r.actor_name ?? 'system'}
                  {r.client_ip ? ` · ${r.client_ip}` : ''}
                  {r.request_id ? ` · req ${r.request_id}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ListBody>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={() => void list.loadMore()} />
    </Card>
  )
}

function ListBody<T>({
  state,
  empty,
  onRetry,
  children,
}: {
  state: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T[] }
  empty: string
  onRetry: () => void
  children: (rows: T[]) => React.ReactNode
}) {
  if (state.status === 'loading') return <LoadingState title="Loading…" />
  if (state.status === 'error') return <ErrorState title="Could not load" description={state.message} onRetry={onRetry} />
  if (state.data.length === 0) return <EmptyState title={empty} />
  return <>{children(state.data)}</>
}
