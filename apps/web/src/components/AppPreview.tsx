/**
 * Abstract, static representation of the AssessX desktop client.
 * Decorative only — the real application is a separate Tauri app.
 */
const STATUS_ITEMS = [
  'Identity verified',
  'Camera active',
  'Microphone active',
  'Secure environment',
] as const

export function AppPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[440px] lg:mr-0 lg:ml-auto" aria-hidden="true">
      {/* Offset backdrop card for depth */}
      <div className="border-line bg-card/70 absolute inset-0 translate-x-3 translate-y-3 rounded-xl border" />

      <div className="border-line bg-card shadow-float relative overflow-hidden rounded-xl border">
        {/* Window chrome */}
        <div className="border-line flex items-center gap-2 border-b px-4 py-3">
          <span className="bg-line-strong h-2.5 w-2.5 rounded-full" />
          <span className="bg-line-strong h-2.5 w-2.5 rounded-full" />
          <span className="bg-line-strong h-2.5 w-2.5 rounded-full" />
          <span className="text-ink ml-3 text-[13px] font-semibold tracking-tight">
            Assess<span className="text-accent">X</span>
          </span>
        </div>

        <div className="px-5 py-5">
          <div className="flex items-baseline justify-between">
            <p className="text-ink text-[15px] font-semibold">Assessment Session</p>
            <p className="text-ink-subtle font-mono text-xs tabular-nums">00:47:12</p>
          </div>

          <hr className="border-line my-4" />

          <ul className="space-y-2.5">
            {STATUS_ITEMS.map((item) => (
              <li key={item} className="flex items-center gap-2.5 text-[14px]">
                <span className="bg-ok inline-block h-2 w-2 rounded-full ring-4 ring-emerald-100" />
                <span className="text-ink-muted">{item}</span>
              </li>
            ))}
          </ul>

          <div className="border-line bg-surface mt-5 flex items-center justify-between rounded-lg border px-3.5 py-3">
            <div>
              <p className="text-ink-subtle text-[11px] font-medium tracking-wide uppercase">
                Risk status
              </p>
              <p className="text-ink mt-0.5 text-[15px] font-semibold">Low</p>
            </div>
            <span className="text-ok inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold">
              LOW
            </span>
          </div>

          <hr className="border-line my-4" />

          <div>
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink-muted">Assessment in progress</span>
              <span className="text-ink-subtle tabular-nums">Q 14 / 40</span>
            </div>
            <div className="bg-line mt-2 h-1.5 w-full overflow-hidden rounded-full">
              <div className="bg-accent h-full w-[35%] rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Small event chip for depth */}
      <div className="border-line bg-card shadow-card absolute -top-4 -right-3 hidden items-center gap-2.5 rounded-lg border px-3 py-2 sm:flex">
        <span className="bg-accent-soft text-accent inline-flex h-6 w-6 items-center justify-center rounded-md">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </span>
        <div className="leading-tight">
          <p className="text-ink text-[12px] font-semibold">Identity verified</p>
          <p className="text-ink-subtle text-[11px]">Liveness check passed</p>
        </div>
      </div>
    </div>
  )
}
