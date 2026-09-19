import { ActivityIcon, ShieldIcon, ScanIcon, VideoIcon } from './icons'

const ITEMS = [
  { label: 'Secure Environment', Icon: ShieldIcon },
  { label: 'AI Proctoring', Icon: ScanIcon },
  { label: 'Live Interviews', Icon: VideoIcon },
  { label: 'Evidence-Based Review', Icon: ActivityIcon },
] as const

export function FeatureStrip() {
  return (
    <section aria-label="Platform overview" className="border-line bg-card border-y">
      <ul className="container-x grid grid-cols-2 gap-x-6 gap-y-4 py-4 lg:grid-cols-4">
        {ITEMS.map(({ label, Icon }) => (
          <li key={label} className="flex items-center gap-3 text-[15px] font-medium">
            <span className="bg-accent-soft text-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
              <Icon size={17} />
            </span>
            <span className="text-ink">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
