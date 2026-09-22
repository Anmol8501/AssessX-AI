import type { ReactNode } from 'react'
import { AlertIcon, ClockIcon, InboxIcon, SpinnerIcon } from '@/components/icons'
import { Button } from './Button'
import { StatusBadge } from './StatusBadge'
import { cn } from '@/lib/cn'

interface StateViewProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** `page` centres in the content area; `inline` sits inside a card. */
  layout?: 'page' | 'inline'
  className?: string
}

/** Shared frame for loading / empty / error / coming-soon states. */
export function StateView({ icon, title, description, action, layout = 'inline', className }: StateViewProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        layout === 'page' ? 'min-h-[50vh] px-6 py-16' : 'px-6 py-12',
        className,
      )}
    >
      <div className="border-line bg-surface text-ink-subtle flex h-11 w-11 items-center justify-center rounded-full border text-[22px]">
        {icon}
      </div>
      <h3 className="text-ink mt-4 text-[15px] font-semibold">{title}</h3>
      {description && <p className="text-ink-subtle mt-1 max-w-sm text-[13.5px]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

interface SimpleStateProps {
  title?: string
  description?: string
  layout?: 'page' | 'inline'
  className?: string
}

export function LoadingState({ title = 'Loading…', description, layout, className }: SimpleStateProps) {
  return (
    <div role="status" aria-live="polite">
      <StateView icon={<SpinnerIcon />} title={title} description={description} layout={layout} className={className} />
    </div>
  )
}

export function EmptyState({
  title = 'Nothing here yet',
  description,
  action,
  layout,
  className,
}: SimpleStateProps & { action?: ReactNode }) {
  return (
    <StateView icon={<InboxIcon />} title={title} description={description} action={action} layout={layout} className={className} />
  )
}

interface ErrorStateProps extends SimpleStateProps {
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'The application hit an unexpected problem. Try again, and report it if it keeps happening.',
  onRetry,
  layout,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert">
      <StateView
        icon={<AlertIcon className="text-danger" />}
        title={title}
        description={description}
        action={
          onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )
        }
        layout={layout}
        className={className}
      />
    </div>
  )
}

interface ComingSoonProps extends SimpleStateProps {
  /** Roadmap phase that delivers this area, e.g. "Phase 2 — Assessment Creation". */
  phase: string
}

/** Placeholder for a navigation destination whose feature is scheduled for a later phase. */
export function ComingSoon({ title = 'Not available yet', description, phase, layout = 'page', className }: ComingSoonProps) {
  return (
    <StateView
      icon={<ClockIcon />}
      title={title}
      description={description}
      action={<StatusBadge tone="accent">{phase}</StatusBadge>}
      layout={layout}
      className={className}
    />
  )
}
