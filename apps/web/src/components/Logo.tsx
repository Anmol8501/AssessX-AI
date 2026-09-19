type LogoProps = { className?: string; inverted?: boolean }

export function Logo({ className = '', inverted = false }: LogoProps) {
  return (
    <span
      className={`inline-flex items-center text-[19px] font-semibold tracking-tight ${inverted ? 'text-white' : 'text-ink'} ${className}`}
    >
      Assess<span className="text-accent">X</span>
    </span>
  )
}
