import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-line bg-card shadow-card rounded-lg border', className)} {...rest} />
}

interface CardHeaderProps {
  title: string
  description?: string
  actions?: ReactNode
}

export function CardHeader({ title, description, actions }: CardHeaderProps) {
  return (
    <div className="border-line flex items-start justify-between gap-4 border-b px-5 py-4">
      <div>
        <h2 className="text-ink text-[15px] font-semibold">{title}</h2>
        {description && <p className="text-ink-subtle mt-0.5 text-[13px]">{description}</p>}
      </div>
      {actions}
    </div>
  )
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...rest} />
}

interface StatCardProps {
  label: string
  /** Display value. Use `null` when there is no data source yet — renders an em dash, never a fake number. */
  value: string | number | null
  hint?: string
}

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <Card className="px-5 py-4">
      <p className="text-ink-subtle text-[12.5px] font-medium tracking-wide uppercase">{label}</p>
      <p className={cn('mt-1.5 text-[28px] leading-none font-semibold tabular-nums', value === null ? 'text-ink-subtle' : 'text-ink')}>
        {value ?? '—'}
      </p>
      {hint && <p className="text-ink-subtle mt-2 text-[12.5px]">{hint}</p>}
    </Card>
  )
}
