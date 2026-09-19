# AssessX — Public Website

Landing and download portal for AssessX. This is **not** the examination
application; the exam environment is the Windows desktop client (see
`docs/PROJECT-CONTEXT.md` §11–12).

Stack: React 19 · TypeScript · Vite 8 · Tailwind CSS 4. No runtime
dependencies beyond React and the self-hosted Inter font.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
npm run lint       # oxlint
npx tsc -b         # type-check only
```

## Download configuration

All "Download for Windows" buttons read one module, `src/config/download.ts`.
Nothing else in the site knows the URL.

| Variable | Default | Effect |
|---|---|---|
| `VITE_ASSESSX_DOWNLOAD_URL` | `/downloads/AssessX-Setup.exe` | Where the buttons link. |
| `VITE_ASSESSX_DOWNLOAD_AVAILABLE` | `false` | While `false`, buttons render as a disabled "installer coming soon" control instead of linking to a file that does not exist. |

To publish the installer, either:

1. Place `AssessX-Setup.exe` in `public/downloads/` and set
   `VITE_ASSESSX_DOWNLOAD_AVAILABLE=true`, or
2. Set `VITE_ASSESSX_DOWNLOAD_URL` to an external release URL and set
   `VITE_ASSESSX_DOWNLOAD_AVAILABLE=true`.

Copy `.env.example` to `.env.local` for local overrides. Environment
variables are read at build time.

## Structure

```
src/
  components/   Navbar, Hero, AppPreview, FeatureStrip, Capabilities,
                HowItWorks, SecuritySection, DownloadCTA, Footer,
                DownloadButton, Logo, Reveal, icons
  config/       download.ts (installer), site.ts (nav links, GitHub URL)
  hooks/        useReveal.ts (IntersectionObserver fade-in)
  index.css     Tailwind theme tokens, base styles, button/utility classes
```

Design tokens (colors, type scale, shadows) live in `@theme` in
`src/index.css`. Scroll-reveal animation is CSS-only and disabled under
`prefers-reduced-motion`.

## Content rules

Per the PRD/TRD: no invented statistics, customers, certifications,
testimonials or security guarantees on this site. Footer links only point
to sections and resources that exist.
