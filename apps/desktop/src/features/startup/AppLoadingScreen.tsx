import { SpinnerIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'

/** Shown while the application initialises (configuration + session check). */
export function AppLoadingScreen() {
  return (
    <div className="bg-surface flex h-full w-full flex-col items-center justify-center" role="status" aria-live="polite">
      <Logo withMark size="md" />
      <div className="text-ink-subtle mt-6 flex items-center gap-2 text-[13px]">
        <SpinnerIcon className="text-[16px]" />
        Starting AssessX…
      </div>
    </div>
  )
}
