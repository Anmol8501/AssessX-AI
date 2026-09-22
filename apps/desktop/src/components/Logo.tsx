import { cn } from '@/lib/cn'

interface LogoProps {
  className?: string
  /** For dark surfaces (sidebar, hero). */
  inverted?: boolean
  /** Renders the mark next to the wordmark. */
  withMark?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const sizes = { sm: 'text-[17px]', md: 'text-[19px]', lg: 'text-[34px]' } as const
const markSizes = { sm: 'h-5 w-5', md: 'h-6 w-6', lg: 'h-10 w-10' } as const

/** AssessX wordmark. */
export function Logo({ className, inverted = false, withMark = false, size = 'md' }: LogoProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-semibold tracking-tight',
        sizes[size],
        inverted ? 'text-white' : 'text-ink',
        className,
      )}
    >
      {withMark && <LogoMark className={markSizes[size]} inverted={inverted} />}
      <span>
        Assess<span className="text-accent">X</span>
      </span>
    </span>
  )
}

interface LogoMarkProps {
  className?: string
  /** Light stroke for dark surfaces. */
  inverted?: boolean
  /** Renders the mark on its dark app-icon tile. */
  tile?: boolean
}

/**
 * "Verified X" mark: one stroke of the X is a checkmark — assessment, verified.
 * Same geometry as app-icon.svg / public/favicon.svg.
 */
export function LogoMark({ className, inverted = false, tile = false }: LogoMarkProps) {
  const stroke = tile || inverted ? '#f9fafb' : '#111827'
  return (
    <svg viewBox="0 0 32 32" className={cn('shrink-0', className)} aria-hidden="true">
      {tile && <rect width="32" height="32" rx="7" fill="#111827" />}
      <path d="M8 7l9.5 11.5" stroke={stroke} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M8 18.5l5.5 6.5L25 7.5" fill="none" stroke="#2563eb" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
