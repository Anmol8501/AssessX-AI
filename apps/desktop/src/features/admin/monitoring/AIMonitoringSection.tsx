import { useEffect, useState } from 'react'
import { StatusBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { activeObservationLabel, aiIndicators, aiStatusLabel, formatDuration } from './ai'
import type { AIMonitoringState } from './types'

/**
 * The "AI Monitoring" section of the candidate detail view (Phase 5C).
 *
 * It shows, factually and live (the server re-derives it on every AI event and pushes it with the
 * session update): whether the on-device AI is working, what it currently measures, and which
 * observations are ongoing and for how long. The AI's health is shown apart from the observations,
 * so a failed AI reads as "Unknown", never as a normal candidate. There is no score, risk level or
 * verdict here — Phase 5C does not determine whether a candidate cheated.
 */
export function AIMonitoringSection({ ai }: { ai: AIMonitoringState }) {
  const status = aiStatusLabel(ai)
  const indicators = aiIndicators(ai)
  const now = useNow(ai.active.length > 0)

  return (
    <section className="border-line mt-4 rounded-md border p-3" aria-label="AI monitoring">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ink text-[13px] font-semibold">AI Monitoring</h3>
        <StatusBadge tone={status.tone} dot>
          AI {status.label}
        </StatusBadge>
      </div>
      {status.detail && <p className="text-ink-subtle mt-1 text-[12px]">{status.detail}</p>}

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]" aria-label="AI observations now">
        {indicators.map((indicator) => (
          <div key={indicator.label} className="flex items-center gap-2" data-ai-indicator={indicator.label}>
            <span className="text-ink-subtle">{indicator.label}:</span>
            <span
              className={cn(
                'font-medium',
                indicator.ok === null ? 'text-ink-subtle' : indicator.ok ? 'text-ink' : 'text-warn',
              )}
            >
              {indicator.value}
            </span>
          </div>
        ))}
      </dl>

      <h4 className="text-ink mt-3 text-[12.5px] font-semibold">Ongoing observations</h4>
      <ul className="mt-1 space-y-1" aria-label="Ongoing AI observations">
        {ai.active.length === 0 ? (
          <li className="text-ink-subtle text-[12px]">None.</li>
        ) : (
          ai.active.map((observation) => (
            <li key={`${observation.eventType}:${observation.startedAt}`} className="flex justify-between gap-2 text-[12px]">
              <span className="text-ink">{activeObservationLabel(observation)}</span>
              <span className="text-ink-subtle tabular-nums">
                since {new Date(observation.startedAt).toLocaleTimeString()} · {formatDuration(now - Date.parse(observation.startedAt))}
              </span>
            </li>
          ))
        )}
      </ul>

      <p className="text-ink-subtle mt-3 text-[11.5px]">
        Factual on-device camera observations with provisional thresholds; head orientation is relative
        to the candidate’s own calibrated position, and gaze is not used. They do not determine whether a
        candidate cheated.
      </p>
    </section>
  )
}

/** Wall-clock now, re-read every second only while something needs a running duration. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [ticking])
  return now
}
