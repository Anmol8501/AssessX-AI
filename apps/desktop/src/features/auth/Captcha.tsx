import { useId } from 'react'
import { RefreshIcon, SpinnerIcon } from '@/components/icons'
import { Input } from '@/components/ui'
import type { LoginChallenge } from '@/features/session'
import { cn } from '@/lib/cn'

const ANSWER_LENGTH = 6

interface CaptchaProps {
  /** Server-issued challenge (image only — the answer is verified by the backend). */
  challenge: LoginChallenge | null
  loading: boolean
  /** Message when the challenge could not be fetched. */
  loadError?: string | null
  onRefresh(): void
  value: string
  onChange(value: string): void
  error?: string
  disabled?: boolean
}

/** Sign-in security check: shows the server-drawn code and collects the user's answer. */
export function Captcha({ challenge, loading, loadError, onRefresh, value, onChange, error, disabled }: CaptchaProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? loadError

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-ink text-[13px] font-medium">
        Security check
      </label>
      <div className="flex items-stretch gap-2">
        <div
          className={cn(
            'border-line-strong bg-surface relative flex h-12 w-[152px] shrink-0 items-center justify-center overflow-hidden rounded-md border',
            disabled && 'opacity-60',
          )}
          role="img"
          aria-label={challenge ? 'Verification code image' : 'Verification code unavailable'}
        >
          {challenge && !loading ? (
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(challenge.imageSvg)}`}
              alt=""
              className="h-full w-full"
              draggable={false}
              data-challenge-id={challenge.id}
            />
          ) : (
            <SpinnerIcon className={cn('text-ink-subtle text-[18px]', !loading && 'hidden')} />
          )}
        </div>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          placeholder="Code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={ANSWER_LENGTH}
          aria-describedby={message ? messageId : undefined}
          invalid={Boolean(error)}
          disabled={disabled || !challenge}
          className="h-12 font-mono tracking-[0.2em] uppercase"
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || loading}
          className="border-line-strong bg-card text-ink-subtle hover:border-ink-subtle hover:text-ink flex h-12 w-12 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-60"
          aria-label="Get a new code"
          title="Get a new code"
        >
          <RefreshIcon className="text-[18px]" />
        </button>
      </div>
      {message ? (
        <p id={messageId} className="text-danger text-[12.5px]" role="alert">
          {message}
        </p>
      ) : (
        <p className="text-ink-subtle text-[12.5px]">Type the characters shown. Letters are not case-sensitive.</p>
      )}
    </div>
  )
}
