import { AppPreview } from './AppPreview'
import { DownloadButton, DownloadCaption } from './DownloadButton'
import { ArrowRightIcon } from './icons'
import { Reveal } from './Reveal'

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="container-x relative grid items-center gap-14 py-16 md:py-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20">
        <Reveal>
          <p className="eyebrow">Secure assessment platform</p>
          <h1 className="text-ink mt-4 text-5xl leading-[1.08] font-semibold tracking-[-0.02em] md:text-6xl">
            Assess with confidence.
          </h1>
          <p className="text-ink mt-5 text-xl leading-snug font-medium md:text-[22px]">
            AI-powered exams, proctoring and interviews — built for secure, scalable assessment.
          </p>
          <p className="text-ink-muted text-body mt-5 max-w-xl">
            AssessX combines a secure Windows exam environment with multimodal AI proctoring and
            intelligent candidate evaluation to help organizations conduct trusted assessments
            remotely.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <DownloadButton size="lg" />
            <a href="#platform" className="btn btn-secondary btn-lg">
              Explore the Platform
              <ArrowRightIcon size={16} />
            </a>
          </div>
          <DownloadCaption>Windows 10/11 • Desktop application</DownloadCaption>
        </Reveal>

        <Reveal delay={120} className="w-full lg:justify-self-end">
          <AppPreview />
        </Reveal>
      </div>
    </section>
  )
}
