import { SUPPORTED_WINDOWS } from '../config/download'
import { DownloadButton, DownloadCaption } from './DownloadButton'
import { Reveal } from './Reveal'

export function DownloadCTA() {
  return (
    <section id="download" className="pb-16 md:pb-20">
      <div className="container-x">
        <Reveal>
          <div className="border-line bg-card shadow-card mx-auto max-w-3xl rounded-2xl border px-6 py-10 text-center md:px-12 md:py-12">
            <h2 className="text-ink text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
              Ready to assess securely?
            </h2>
            <p className="text-ink-muted text-body mx-auto mt-4 max-w-xl">
              Download the AssessX desktop application for Windows and start your secure
              assessment environment.
            </p>
            <div className="mt-8">
              <DownloadButton size="lg" label="Download AssessX for Windows" />
            </div>
            <DownloadCaption>{SUPPORTED_WINDOWS}</DownloadCaption>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
