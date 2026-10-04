import { useCallback, useMemo, useState } from 'react'
import type { Report } from '../ai/events/processor'

/**
 * The candidate-facing side of the on-device AI (exam rules): which observed conditions are going on
 * *now*, so the exam screen can show a plain instruction ("Keep your face in view") while each lasts.
 *
 * It follows the same debounced episodes the AI already reports for the administrator (`phase:
 * started` / `resolved`), by wrapping the reporter the pipeline is given. Warnings only: nothing here
 * counts toward locking the exam, because AI detections can be wrong (lighting, glasses, angle).
 */
export function useAIWarnings(report: Report) {
  const [active, setActive] = useState<Record<string, string>>({})

  const wrapped: Report = useCallback(
    (eventType, metadata) => {
      const phase = metadata.phase
      const episode = typeof metadata.episode_id === 'string' ? metadata.episode_id : null
      if (episode && (phase === 'started' || phase === 'resolved')) {
        setActive((current) => {
          if (phase === 'started') return current[eventType] === episode ? current : { ...current, [eventType]: episode }
          if (current[eventType] !== episode) return current
          const next = { ...current }
          delete next[eventType]
          return next
        })
      }
      return report(eventType, metadata)
    },
    [report],
  )

  const conditions = useMemo(() => Object.keys(active), [active])
  return { report: wrapped, conditions }
}
