import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'

const tones: Record<StatusTone, string> = {
  neutral: 'bg-gray-100 text-ink-muted',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
}

const dots: Record<StatusTone, string> = {
  neutral: 'bg-ink-subtle',
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
}

interface StatusBadgeProps {
  tone?: StatusTone
  /** Adds a leading status dot. */
  dot?: boolean
  className?: string
  children: ReactNode
}

export function StatusBadge({ tone = 'neutral', dot = false, className, children }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  )
}
