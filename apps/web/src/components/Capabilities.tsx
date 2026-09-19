import { CameraIcon, MonitorIcon, TimelineIcon, UsersIcon } from './icons'
import { Reveal } from './Reveal'

const CARDS = [
  {
    title: 'Secure Assessments',
    body: 'Run controlled examinations through the AssessX Windows application with system checks, session controls and configurable exam policies.',
    Icon: MonitorIcon,
  },
  {
    title: 'Multimodal Proctoring',
    body: 'Analyze camera, audio and screen signals to identify suspicious activity and generate explainable integrity events.',
    Icon: CameraIcon,
  },
  {
    title: 'Intelligent Interviews',
    body: 'Conduct adaptive AI interviews or connect candidates and interviewers through live video.',
    Icon: UsersIcon,
  },
  {
    title: 'Evidence, Not Guesswork',
    body: 'Turn suspicious events into timestamped evidence, risk signals and reviewable reports.',
    Icon: TimelineIcon,
  },
] as const

export function Capabilities() {
  return (
    <section id="platform" className="py-14 md:py-16">
      <div className="container-x">
        <Reveal className="max-w-2xl">
          <p className="eyebrow">Platform</p>
          <h2 className="text-ink mt-3 text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
            One platform. Every assessment layer.
          </h2>
          <p className="text-ink-muted text-body mt-4">
            From the moment a candidate verifies their identity to the final evaluation, AssessX
            brings assessment security and candidate evaluation into one workflow.
          </p>
        </Reveal>

        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ title, body, Icon }, i) => (
            <Reveal key={title} delay={i * 60}>
              <article className="card-hover border-line bg-card shadow-card hover:shadow-card-hover hover:border-line-strong h-full rounded-xl border p-6 transition-[box-shadow,border-color] duration-200">
                <span className="bg-accent-soft text-accent inline-flex h-10 w-10 items-center justify-center rounded-lg">
                  <Icon size={20} />
                </span>
                <h3 className="text-ink mt-5 text-lg font-semibold tracking-tight">{title}</h3>
                <p className="text-ink-muted mt-2 text-[15px] leading-relaxed">{body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
