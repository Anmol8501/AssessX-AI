import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-60'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-sm hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-card text-ink hover:border-ink-subtle hover:bg-gray-50',
  ghost: 'text-ink-muted hover:bg-gray-100 hover:text-ink',
  danger: 'bg-danger text-white shadow-sm hover:bg-red-700',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-[14px]',
  lg: 'h-12 px-6 text-[15px]',
}

/** Button classes for elements that are not <Button> (e.g. a plain <Link>). */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className)
}
