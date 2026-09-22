import type { CSSProperties, ReactNode } from 'react'
import { CameraIcon, CheckIcon, IdCardIcon, LockIcon, MicIcon, MonitoringIcon, ShieldIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { APP_VERSION } from '@/config/app'
import { cn } from '@/lib/cn'

const enterDelay = (ms: number) => ({ '--enter-delay': `${ms}ms` }) as CSSProperties

/** What a secure session verifies before an exam starts (PRD §7, TRD §3.2). */
const SESSION_CHECKS = [
  { icon: IdCardIcon, label: 'Identity verified' },
  { icon: CameraIcon, label: 'Camera active' },
  { icon: MicIcon, label: 'Microphone active' },
  { icon: LockIcon, label: 'Secure exam mode' },
] as const

/** The product principle every proctoring decision follows (PRD §14). */
const PIPELINE = ['Detect', 'Correlate', 'Explain', 'Evidence', 'Human review'] as const

const PILLARS = [
  {
    icon: LockIcon,
    title: 'A controlled exam environment',
    text: 'The exam runs inside this Windows application, not a browser tab — with full-screen and application-switch awareness.',
  },
  {
    icon: MonitoringIcon,
    title: 'Signals, correlated',
    text: 'Camera, microphone and screen events are combined over time. One weak signal is never treated as cheating.',
  },
  {
    icon: ShieldIcon,
    title: 'Evidence, then a person',
    text: 'Every flag carries its reasons and evidence. A reviewer makes the final call — never the AI alone.',
  },
] as const

/**
 * Left half of the sign-in screen: an illustrative view of what AssessX protects.
 * The session card is decorative (aria-hidden) — it shows the *shape* of a secure session,
 * not live data.
 */
export function SecurityShowcase() {
  return (
    <section className="showcase scrollbar-none relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto px-10 py-7 xl:px-14" aria-label="About AssessX exam security">
      {/* Decorative layers are clipped here so they never add scrollable overflow. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="bg-grid absolute inset-0" />
        <div className="showcase-orb absolute" />
      </div>

      <header className="enter relative z-10 flex items-center justify-between">
        <Logo withMark size="sm" />
        <span className="text-ink-subtle text-[12px] font-medium tracking-[0.08em] uppercase">Windows · v{APP_VERSION}</span>
      </header>

      <div className="relative z-10 flex flex-1 flex-col justify-center py-5">
        <p className="enter text-accent text-[12px] font-semibold tracking-[0.14em] uppercase" style={enterDelay(80)}>
          Exam security
        </p>
        <h2 className="enter text-ink mt-3 max-w-md text-[32px] leading-[1.08] font-semibold tracking-[-0.02em] xl:text-[38px]" style={enterDelay(140)}>
          Integrity you can explain.
        </h2>
        <p className="enter text-ink-muted mt-3 max-w-md text-[14px] leading-relaxed" style={enterDelay(200)}>
          AssessX secures the examination environment, watches for signals across camera, microphone and screen, and
          gives reviewers the evidence behind every decision.
        </p>

        {/* Illustrative session card */}
        <div className="enter relative mt-6 max-w-[440px]" style={enterDelay(280)} aria-hidden="true">
          <div className="border-line bg-card/70 absolute inset-0 translate-x-3 translate-y-3 rounded-xl border" />
          <div className="border-line bg-card shadow-float relative overflow-hidden rounded-xl border">
            <div className="border-line flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="bg-line-strong h-2.5 w-2.5 rounded-full" />
                <span className="bg-line-strong h-2.5 w-2.5 rounded-full" />
                <span className="bg-line-strong h-2.5 w-2.5 rounded-full" />
                <span className="text-ink ml-2 text-[13px] font-semibold tracking-tight">
                  Assess<span className="text-accent">X</span> · Secure session
                </span>
              </div>
              <span className="bg-ok-soft text-ok inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium">
                <span className="bg-ok h-1.5 w-1.5 rounded-full" />
                Protected
              </span>
            </div>
            <div className="px-4 py-3.5">
              <ul className="grid grid-cols-2 gap-2">
                {SESSION_CHECKS.map(({ icon: Icon, label }) => (
                  <li key={label} className="border-line bg-surface flex items-center gap-2.5 rounded-md border px-3 py-2 text-[13px]">
                    <span className="bg-accent-soft text-accent flex h-7 w-7 items-center justify-center rounded-md text-[15px]">
                      <Icon />
                    </span>
                    <span className="text-ink font-medium">{label}</span>
                    <CheckIcon className="text-ok ml-auto text-[15px]" />
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <p className="text-ink-subtle text-[11.5px] font-semibold tracking-[0.1em] uppercase">How a flag is handled</p>
                <ol className="mt-2 flex flex-wrap items-center gap-1">
                  {PIPELINE.map((step, index) => (
                    <li key={step} className="flex items-center gap-1">
                      <span
                        className={cn(
                          'rounded-md px-1.5 py-1 text-[11px] font-medium whitespace-nowrap',
                          index === PIPELINE.length - 1 ? 'bg-ink text-white' : 'bg-accent-soft text-accent',
                        )}
                      >
                        {step}
                      </span>
                      {index < PIPELINE.length - 1 && <span className="text-line-strong text-[11px]">→</span>}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* Pillars */}
        <ul className="mt-6 max-w-[520px] space-y-2.5">
          {PILLARS.map(({ icon: Icon, title, text }, index) => (
            <Pillar key={title} icon={<Icon />} title={title} text={text} style={enterDelay(360 + index * 60)} />
          ))}
        </ul>
      </div>

      <p className="enter text-ink-subtle relative z-10 text-[12px] [@media(max-height:859px)]:hidden" style={enterDelay(560)}>
        Secure-mode capabilities depend on the assessment policy and are documented with their limitations.
      </p>
    </section>
  )
}

function Pillar({ icon, title, text, style }: { icon: ReactNode; title: string; text: string; style?: CSSProperties }) {
  return (
    <li className="enter flex items-start gap-3.5" style={style}>
      <span className="border-line bg-card text-accent mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-[18px] shadow-card">
        {icon}
      </span>
      <span>
        <span className="text-ink block text-[14px] font-semibold">{title}</span>
        <span className="text-ink-muted mt-0.5 block text-[12.5px] leading-snug">{text}</span>
      </span>
    </li>
  )
}
