import { AlertIcon, CheckIcon, SpinnerIcon } from '@/components/icons'
import type { SaveState } from './types'

/**
 * Whether the server has confirmed what is on screen.
 *
 * "Saved" is shown only after the server said so. A failed save says so plainly and offers a
 * retry, because a candidate who believes a lost answer was stored has no way to recover it.
 */
export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === 'idle') return null

  if (state === 'saving') {
    return (
      <p className="text-ink-subtle inline-flex items-center gap-1.5 text-[12.5px]" role="status">
        <SpinnerIcon className="text-[14px]" />
        Saving…
      </p>
    )
  }

  if (state === 'saved') {
    return (
      <p className="text-ok inline-flex items-center gap-1.5 text-[12.5px]" role="status">
        <CheckIcon className="text-[14px]" />
        Saved
      </p>
    )
  }

  return (
    <p className="text-danger inline-flex flex-wrap items-center gap-1.5 text-[12.5px]" role="alert">
      <AlertIcon className="text-[14px]" />
      Not saved — your answer is on this screen only.
      <button type="button" onClick={onRetry} className="text-danger font-medium underline underline-offset-2">
        Try again
      </button>
    </p>
  )
}
