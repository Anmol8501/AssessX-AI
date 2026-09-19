import { Reveal } from './Reveal'

const STEPS = [
  {
    n: '01',
    title: 'Download',
    body: 'Candidate installs the AssessX Windows application.',
  },
  {
    n: '02',
    title: 'Verify',
    body: 'Camera, microphone, system and identity checks are completed before the assessment.',
  },
  {
    n: '03',
    title: 'Assess',
    body: 'Candidate completes the exam or interview while relevant security signals are monitored.',
  },
  {
    n: '04',
    title: 'Review',
    body: 'AssessX organizes events, evidence and evaluation data into a clear candidate report.',
  },
] as const

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-line bg-card border-y py-14 md:py-16">
      <div className="container-x">
        <Reveal className="max-w-2xl">
          <p className="eyebrow">How it works</p>
          <h2 className="text-ink mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
            From candidate to evaluation.
          </h2>
        </Reveal>

        <ol className="relative mt-8 grid gap-8 md:grid-cols-4 md:gap-6">
          {/* Connecting line: vertical on mobile, horizontal on desktop */}
          <span
            aria-hidden="true"
            className="bg-line absolute top-0 bottom-0 left-[15px] w-px md:top-[15px] md:right-[12.5%] md:bottom-auto md:left-[12.5%] md:h-px md:w-auto"
          />
          {STEPS.map(({ n, title, body }, i) => (
            <li key={n} className="relative pl-12 md:pl-0">
              <Reveal delay={i * 80}>
                <span className="bg-card text-accent border-line-strong absolute top-0 left-0 inline-flex h-8 w-8 items-center justify-center rounded-full border font-mono text-[12px] font-semibold md:relative">
                  {n}
                </span>
                <h3 className="text-ink mt-0.5 text-lg font-semibold tracking-tight md:mt-5">
                  {title}
                </h3>
                <p className="text-ink-muted mt-2 max-w-xs text-[15px] leading-relaxed">{body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
