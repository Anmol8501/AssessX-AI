import { ShieldIcon } from './icons'
import { Reveal } from './Reveal'

const PIPELINE = ['Detect', 'Correlate', 'Explain', 'Review'] as const

export function SecuritySection() {
  return (
    <section id="security" className="py-14 md:py-16">
      <div className="container-x">
        <Reveal>
          <div className="bg-ink relative overflow-hidden rounded-2xl px-6 py-10 text-white md:px-12 md:py-12">
            <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
              <div className="max-w-2xl">
                <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-cyan-300 uppercase">
                  <ShieldIcon size={15} />
                  Security
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
                  Security built into the assessment.
                </h2>
                <p className="text-body mt-4 text-gray-300">
                  AssessX uses a defense-in-depth approach. Instead of relying on a single signal,
                  the platform correlates identity, video, audio, screen and session events to
                  create an explainable assessment-integrity picture.
                </p>
              </div>

              <ol
                className="flex flex-wrap items-center gap-2 md:flex-col md:items-stretch md:gap-0"
                aria-label="Integrity pipeline"
              >
                {PIPELINE.map((step, i) => (
                  <li key={step} className="flex items-center md:flex-col">
                    <span className="inline-flex min-w-[7.5rem] items-center justify-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium">
                      {step}
                    </span>
                    {i < PIPELINE.length - 1 && (
                      <span aria-hidden="true" className="px-2 text-gray-500 md:py-1 md:px-0">
                        <span className="md:hidden">→</span>
                        <span className="hidden md:inline">↓</span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
