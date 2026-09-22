import type { CSSProperties } from 'react'
import { ArrowRightIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { ButtonLink } from '@/components/ui'
import { APP_TAGLINE, APP_VALUES, APP_VERSION } from '@/config/app'
import { routes } from '@/app/routes'
import { MonitorDemo } from './MonitorDemo'

/** Staggers the `.enter` reveal (see index.css). */
const enterDelay = (ms: number) => ({ '--enter-delay': `${ms}ms` }) as CSSProperties

/** The product principle, PRD §14. */
const STAGES = [
  { n: '01', label: 'Secure environment' },
  { n: '02', label: 'Signals correlated' },
  { n: '03', label: 'Evidence attached' },
  { n: '04', label: 'Human review' },
] as const

/**
 * Launch screen. Copy follows the PRD/KB honesty rules:
 * it describes what AssessX is designed to do without accuracy or "unbreakable" claims.
 */
export function WelcomePage() {
  return (
    <div className="entry relative flex h-full w-full flex-col overflow-hidden">
      {/* Geometry */}
      <div className="tri tri-a" aria-hidden="true" />
      <div className="tri tri-b" aria-hidden="true" />
      <div className="tri tri-c" aria-hidden="true" />

      {/* Top bar */}
      <header className="enter relative z-10 flex h-14 shrink-0 items-center justify-between px-8">
        <Logo withMark size="sm" />
        <span className="text-ink-muted border-line rounded-full border bg-white/80 px-3 py-1 text-[12px] font-medium tracking-[0.08em] uppercase backdrop-blur">
          Windows · v{APP_VERSION}
        </span>
      </header>

      {/* Stage */}
      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)] items-center gap-10 px-8 xl:gap-16 xl:px-14">
        {/* Left — message */}
        <div className="max-w-[440px]">
          <p className="enter text-accent text-[12px] font-semibold tracking-[0.14em] uppercase" style={enterDelay(80)}>
            {APP_TAGLINE}
          </p>
          <h1 className="enter mt-4 text-[44px] leading-[1.02] text-ink font-semibold tracking-[-0.02em] xl:text-[54px]" style={enterDelay(140)}>
            Secure.
            <br />
            Intelligent.
            <br />
            Fair.
          </h1>
          <p className="enter mt-5 max-w-[400px] text-ink-muted text-[15px] leading-relaxed" style={enterDelay(200)}>
            AssessX turns a Windows PC into a controlled examination environment and pairs it with proctoring that
            explains what it saw — so reviewers decide with evidence, not guesses.
          </p>
          <div className="enter mt-8" style={enterDelay(260)}>
            <ButtonLink to={routes.login} size="lg" className="shadow-float px-8" trailingIcon={<ArrowRightIcon className="text-[18px]" />}>
              Get Started
            </ButtonLink>
          </div>
          <ul className="enter mt-8 flex items-center gap-3 text-ink-subtle text-[11.5px] font-medium tracking-[0.1em] uppercase" style={enterDelay(320)}>
            {APP_VALUES.map((value, index) => (
              <li key={value} className="flex items-center gap-3">
                {index > 0 && <span className="bg-line-strong h-1 w-1 rounded-full" aria-hidden="true" />}
                {value}
              </li>
            ))}
          </ul>
        </div>

        {/* Right — laptop with the monitoring preview */}
        <div className="enter flex flex-col items-center" style={enterDelay(240)}>
          <MonitorDemo className="max-w-[640px]" />
          <p className="mt-4 text-ink-subtle text-[11px] font-medium tracking-[0.12em] uppercase">Illustrative preview of live monitoring</p>
        </div>
      </div>

      {/* Bottom strip */}
      <div className="enter relative z-10 mx-8 mb-6 shrink-0 xl:mx-14" style={enterDelay(400)}>
        <ol className="border-line bg-card shadow-card grid grid-cols-4 overflow-hidden rounded-lg border">
          {STAGES.map(({ n, label }, index) => (
            <li key={n} className={`flex items-center gap-3 px-5 py-3.5 ${index > 0 ? 'border-line border-l' : ''}`}>
              <span className="text-accent font-mono text-[12px] font-semibold">{n}</span>
              <span className="text-ink text-[13px] font-medium">{label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
