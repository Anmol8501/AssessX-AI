import { useEffect, useState } from 'react'
import { NAV_LINKS } from '../config/site'
import { DownloadButton } from './DownloadButton'
import { CloseIcon, MenuIcon } from './icons'
import { Logo } from './Logo'

export function Navbar() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header
      className={`bg-surface/90 sticky top-0 z-50 border-b backdrop-blur-sm transition-[border-color] duration-200 ${
        scrolled || open ? 'border-line' : 'border-transparent'
      }`}
    >
      <nav className="container-x flex h-16 items-center justify-between" aria-label="Primary">
        <a href="#top" className="rounded-sm" aria-label="AssessX home">
          <Logo />
        </a>

        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="text-ink-muted hover:text-ink rounded-sm text-[15px] font-medium transition-colors"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden md:block">
          <DownloadButton />
        </div>

        <button
          type="button"
          className="text-ink hover:bg-line/60 -mr-2 inline-flex h-10 w-10 items-center justify-center rounded-md md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <CloseIcon size={22} /> : <MenuIcon size={22} />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-line bg-surface border-t md:hidden">
          <div className="container-x flex flex-col gap-1 py-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-ink hover:bg-line/50 rounded-md px-3 py-2.5 text-base font-medium"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 px-3">
              <DownloadButton className="w-full" />
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
