import { CheckIcon } from '@/components/icons'
import { cn } from '@/lib/cn'
import { BUILDER_STEPS, STEP_LABEL, type BuilderStep } from './steps'

interface BuilderStepsProps {
  current: BuilderStep
  onSelect(step: BuilderStep): void
  /** Steps with outstanding readiness issues, marked so problems are visible from anywhere. */
  incomplete: ReadonlySet<BuilderStep>
  /** Replaces a step's sub-label where readiness is not what the step is about. */
  hints?: Partial<Record<BuilderStep, string>>
}

/** Horizontal stepper. Every step is reachable at any time — saved data is never lost by moving. */
export function BuilderSteps({ current, onSelect, incomplete, hints }: BuilderStepsProps) {
  return (
    <nav aria-label="Assessment builder steps" className="border-line bg-card shadow-card rounded-lg border">
      <ol className="grid grid-cols-5">
        {BUILDER_STEPS.map((step, index) => {
          const active = step === current
          const hasIssues = incomplete.has(step)
          return (
            <li key={step} className={index > 0 ? 'border-line border-l' : undefined}>
              <button
                type="button"
                onClick={() => onSelect(step)}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                  active ? 'bg-accent-soft' : 'hover:bg-surface',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                    active
                      ? 'bg-accent text-white'
                      : hasIssues
                        ? 'bg-warn-soft text-warn'
                        : 'bg-ok-soft text-ok',
                  )}
                >
                  {hasIssues || active ? index + 1 : <CheckIcon className="text-[14px]" />}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate text-[13.5px] font-medium', active ? 'text-accent' : 'text-ink')}>
                    {STEP_LABEL[step]}
                  </span>
                  <span className={cn('block text-[11.5px]', hasIssues ? 'text-warn' : 'text-ink-subtle')}>
                    {hints?.[step] ?? (hasIssues ? 'Needs attention' : 'Complete')}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
