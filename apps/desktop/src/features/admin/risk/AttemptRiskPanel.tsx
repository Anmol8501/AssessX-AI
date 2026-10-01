import { StatusBadge } from '@/components/ui'
import { eventTypeLabel } from '../monitoring/events'
import { formatPoints, formatSeconds, formatTime, riskLevel } from './labels'
import { useAttemptRisk } from './useAttemptRisk'

const TOP_CONTRIBUTORS = 5
const LISTED_WINDOWS = 3

/**
 * "Attempt risk" (Phase 6A): the server's risk state for one attempt, with what contributed to it.
 *
 * Shows the level and score now, the peak over the attempt (so an early incident stays visible),
 * the main contributing signals with their points, correlated moments, AI coverage gaps, the policy
 * version and when it was calculated — and says plainly that it is not a verdict. No evidence
 * timeline (Phase 6B) and no review decision (Phase 6C) here.
 */
export function AttemptRiskPanel({ attemptId, live, refreshKey }: { attemptId: string; live: boolean; refreshKey?: string | number }) {
  const { state } = useAttemptRisk(attemptId, { live, refreshKey })

  return (
    <section className="border-line mt-4 rounded-md border p-3" aria-label="Attempt risk">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ink text-[13px] font-semibold">Attempt risk</h3>
        {state.status === 'ready' && (
          <StatusBadge tone={riskLevel(state.risk.level).tone} dot>
            Risk {riskLevel(state.risk.level).label}
          </StatusBadge>
        )}
      </div>

      {state.status === 'loading' && <p className="text-ink-subtle mt-2 text-[12.5px]">Calculating…</p>}
      {state.status === 'error' && <p className="text-ink-subtle mt-2 text-[12.5px]">Risk is unavailable: {state.message}</p>}

      {state.status === 'ready' && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px]">
            <div className="flex gap-2" data-risk="score">
              <dt className="text-ink-subtle">{live ? 'Score now:' : 'Score at end:'}</dt>
              <dd className="text-ink font-medium tabular-nums">{state.risk.currentScore} / 100</dd>
            </div>
            <div className="flex gap-2" data-risk="peak">
              <dt className="text-ink-subtle">Peak:</dt>
              <dd className="text-ink font-medium tabular-nums">
                {state.risk.peakScore} ({riskLevel(state.risk.peakLevel).label})
                {state.risk.peakAt && <span className="text-ink-subtle font-normal"> at {formatTime(state.risk.peakAt)}</span>}
              </dd>
            </div>
          </dl>

          <h4 className="text-ink mt-3 text-[12.5px] font-semibold">Contributing signals</h4>
          <ul className="mt-1 space-y-1" aria-label="Contributing signals">
            {state.risk.contributors.length === 0 ? (
              <li className="text-ink-subtle text-[12px]">None.</li>
            ) : (
              state.risk.contributors.slice(0, TOP_CONTRIBUTORS).map((c) => (
                <li key={c.eventType} className="flex justify-between gap-3 text-[12px]" title={c.reason}>
                  <span className="text-ink">
                    {eventTypeLabel(c.eventType)}
                    <span className="text-ink-subtle">
                      {' '}
                      ×{c.occurrences}
                      {formatSeconds(c.totalSeconds) && ` · ${formatSeconds(c.totalSeconds)}`}
                    </span>
                  </span>
                  <span className="text-ink-subtle tabular-nums">
                    {formatPoints(c.currentPoints)} now · {formatPoints(c.points)} total
                  </span>
                </li>
              ))
            )}
          </ul>

          {state.risk.correlatedWindowCount > 0 && (
            <>
              <h4 className="text-ink mt-3 text-[12.5px] font-semibold">Correlated moments ({state.risk.correlatedWindowCount})</h4>
              <ul className="mt-1 space-y-1" aria-label="Correlated moments">
                {state.risk.correlatedWindows.slice(-LISTED_WINDOWS).map((w) => (
                  <li key={w.startedAt} className="text-ink text-[12px]">
                    <span className="text-ink-subtle tabular-nums">
                      {formatTime(w.startedAt)}–{formatTime(w.endedAt)}:
                    </span>{' '}
                    {w.eventTypes.map(eventTypeLabel).join(', ')}
                  </li>
                ))}
              </ul>
            </>
          )}

          {state.risk.aiUnavailableSeconds >= 1 && (
            <p className="text-ink-subtle mt-3 text-[12px]">
              AI monitoring was unavailable for {formatSeconds(state.risk.aiUnavailableSeconds)} — signals from that time are missing.
            </p>
          )}

          <p className="text-ink-subtle mt-3 text-[11.5px]">
            {state.risk.interpretation} {state.risk.limitations}
          </p>
          <p className="text-ink-subtle mt-1 text-[11px]" data-risk="policy">
            Policy {state.risk.policyVersion} · calculated {formatTime(state.risk.calculatedAt)}
          </p>
        </>
      )}
    </section>
  )
}
