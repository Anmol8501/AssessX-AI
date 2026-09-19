import { GITHUB_URL } from '../config/site'
import { GitHubIcon } from './icons'
import { Logo } from './Logo'

const LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Security', href: '#security' },
  { label: 'Download', href: '#download' },
] as const

export function Footer() {
  return (
    <footer className="border-line bg-card border-t">
      <div className="container-x flex flex-col gap-8 py-8 md:flex-row md:items-start md:justify-between">
        <div>
          <Logo />
          <p className="text-ink-muted mt-2 text-[15px]">Trusted assessments. Smarter evaluation.</p>
        </div>

        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-ink-muted hover:text-ink rounded-sm font-medium">
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-muted hover:text-ink inline-flex items-center gap-1.5 rounded-sm font-medium"
              >
                <GitHubIcon size={16} />
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-line border-t">
        <p className="container-x text-ink-subtle py-5 text-sm">
          © 2026 AssessX. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
