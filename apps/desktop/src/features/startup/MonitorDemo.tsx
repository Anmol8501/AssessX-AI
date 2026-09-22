import type { ReactNode } from 'react'
import { AlertIcon, CameraIcon, CheckIcon, MicIcon, MonitoringIcon, ShieldIcon } from '@/components/icons'
import { cn } from '@/lib/cn'

/**
 * Illustrative preview of live monitoring, drawn with CSS/SVG and animated on a 14-second cycle
 * (see `demo-*` keyframes in index.css). No video, no data: it shows the *shape* of the product's
 * principle — a signal is detected, correlated, backed by evidence, and a person decides.
 * Deliberately never says "cheating caught": that is not what AssessX claims.
 *
 * The screen mirrors the real application shell (dark sidebar, light content) so the preview
 * reads clearly on the light launch screen.
 */

const TILES = [
  { id: '01', flagged: false },
  { id: '02', flagged: true },
  { id: '03', flagged: false },
  { id: '04', flagged: false },
] as const

export function MonitorDemo({ className }: { className?: string }) {
  return (
    <div className={cn('relative w-full', className)} aria-hidden="true">
      {/* Laptop lid */}
      <div className="rounded-t-xl border border-slate-700 bg-[#111827] p-2 pb-0 shadow-[0_36px_70px_-28px_rgb(17_24_39/0.55)]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-white">
          <Screen />
        </div>
      </div>
      {/* Base */}
      <div className="mx-[-4%] h-3 rounded-b-xl border border-t-0 border-slate-400 bg-gradient-to-b from-slate-200 to-slate-400" />
      <div className="mx-auto h-1 w-[28%] rounded-b-md bg-slate-400" />
    </div>
  )
}

function Screen() {
  return (
    <div className="flex h-full w-full text-[11px] text-ink">
      {/* Sidebar — same as the real shell */}
      <div className="flex w-[14%] flex-col gap-1.5 bg-[#111827] p-2">
        <span className="mb-1 text-[10px] font-semibold tracking-tight text-white">
          Assess<span className="text-blue-400">X</span>
        </span>
        {['Dashboard', 'Assessments', 'Monitoring', 'Results'].map((item, i) => (
          <span key={item} className={cn('truncate rounded px-1.5 py-1 text-[9px] font-medium', i === 2 ? 'bg-[#1e3a8a] text-white' : 'text-slate-400')}>
            {item}
          </span>
        ))}
      </div>

      {/* Main */}
      <div className="bg-surface flex min-w-0 flex-1 flex-col p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-ink text-[11.5px] font-semibold">Live monitoring · Exam 2026-A</p>
            <p className="text-ink-muted text-[9px]">4 candidates in secure exam mode</p>
          </div>
          <span className="bg-ok-soft text-ok inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-semibold">
            <span className="demo-live bg-ok h-1.5 w-1.5 rounded-full" />
            Live
          </span>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1.35fr_1fr] gap-2">
          {/* Candidate wall */}
          <div className="grid grid-cols-2 grid-rows-2 gap-1.5">
            {TILES.map((tile) => (
              <div
                key={tile.id}
                className={cn(
                  'relative overflow-hidden rounded-md border bg-card',
                  tile.flagged ? 'border-warn ring-warn/40 ring-2' : 'border-line',
                )}
              >
                <Silhouette flagged={tile.flagged} />
                <div className="text-ink absolute top-1 left-1.5 flex items-center gap-1 text-[9px] font-medium">
                  <span className="demo-live bg-ok h-1.5 w-1.5 rounded-full" />
                  Candidate {tile.id}
                </div>
                <div className="text-ink-subtle absolute right-1.5 bottom-1 flex gap-1 text-[10px]">
                  <CameraIcon />
                  <MicIcon />
                </div>
                {tile.flagged && (
                  <div className="demo-step-1 bg-warn absolute top-1 right-1.5 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    <AlertIcon className="text-[10px]" />
                    Flag
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Event / evidence column */}
          <div className="flex min-h-0 flex-col gap-1.5">
            <div className="border-line bg-card rounded-md border p-1.5">
              <p className="text-ink-subtle mb-1 text-[8.5px] font-semibold tracking-[0.1em] uppercase">Candidate 02 · Risk</p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div className="demo-risk from-ok via-warn to-warn h-full w-full rounded-full bg-gradient-to-r" />
              </div>
              <p className="demo-step-2 text-warn mt-1 text-[9px] font-medium">Medium · 2 correlated signals</p>
            </div>

            <ol className="flex flex-1 flex-col gap-1">
              <Step className="demo-step-1" icon={<MonitoringIcon />} tone="warn" title="Window focus lost" meta="12:04:31 · screen" />
              <Step className="demo-step-2" icon={<MicIcon />} tone="warn" title="Second voice detected" meta="12:04:36 · audio" />
              <Step className="demo-step-3" icon={<CameraIcon />} tone="accent" title="Evidence clip attached" meta="8 s · camera + screen" />
              <Step className="demo-step-4" icon={<ShieldIcon />} tone="ink" title="Sent for human review" meta="Reviewer decides — not the AI" />
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({ className, icon, tone, title, meta }: { className: string; icon: ReactNode; tone: 'warn' | 'accent' | 'ink'; title: string; meta: string }) {
  const tones = {
    warn: 'bg-warn-soft text-warn',
    accent: 'bg-accent-soft text-accent',
    ink: 'bg-ink text-white',
  } as const
  return (
    <li className={cn('border-line bg-card flex items-start gap-1.5 rounded-md border p-1.5 shadow-card', className)}>
      <span className={cn('mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px]', tones[tone])}>
        {tone === 'ink' ? <CheckIcon /> : icon}
      </span>
      <span className="min-w-0">
        <span className="text-ink block truncate text-[9.5px] font-semibold">{title}</span>
        <span className="text-ink-muted block truncate text-[8.5px]">{meta}</span>
      </span>
    </li>
  )
}

/** Abstract person at a desk — a shape, not a photo. */
function Silhouette({ flagged }: { flagged: boolean }) {
  return (
    <svg viewBox="0 0 160 100" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`bg-${flagged ? 'f' : 'n'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={flagged ? '#fef3c7' : '#e8eef7'} />
          <stop offset="1" stopColor={flagged ? '#fde68a' : '#d5deea'} />
        </linearGradient>
      </defs>
      <rect width="160" height="100" fill={`url(#bg-${flagged ? 'f' : 'n'})`} />
      <circle cx="80" cy="46" r="15" fill="#64748b" />
      <path d="M44 100c0-22 16-34 36-34s36 12 36 34z" fill="#475569" />
      <rect x="0" y="86" width="160" height="14" fill="#94a3b8" opacity="0.45" />
      {flagged && <path d="M112 56l20-14 6 30z" fill="#b45309" opacity="0.55" />}
    </svg>
  )
}
