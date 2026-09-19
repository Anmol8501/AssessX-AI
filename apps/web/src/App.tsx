import { Capabilities } from './components/Capabilities'
import { DownloadCTA } from './components/DownloadCTA'
import { FeatureStrip } from './components/FeatureStrip'
import { Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { HowItWorks } from './components/HowItWorks'
import { Navbar } from './components/Navbar'
import { SecuritySection } from './components/SecuritySection'

export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <Hero />
        <FeatureStrip />
        <Capabilities />
        <HowItWorks />
        <SecuritySection />
        <DownloadCTA />
      </main>
      <Footer />
    </>
  )
}
