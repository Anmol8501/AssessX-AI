import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  }
}

export const ShieldIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
    <path d="M9.5 12l1.8 1.8L15 10" />
  </svg>
)

export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
)

export const CameraIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" />
    <circle cx="12" cy="13" r="3.25" />
  </svg>
)

export const ScanIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
    <circle cx="12" cy="11" r="2.5" />
    <path d="M8.5 16.5c.8-1.6 2-2.5 3.5-2.5s2.7.9 3.5 2.5" />
  </svg>
)

export const VideoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="13" height="10" rx="2" />
    <path d="M16 11l5-3v8l-5-3z" />
  </svg>
)

export const UsersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0111 0M15 5.5a3 3 0 010 5.5M17.5 13.5a5 5 0 013 4.5" />
  </svg>
)

export const ActivityIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
  </svg>
)

export const TimelineIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
    <circle cx="8" cy="6" r="1.75" fill="currentColor" stroke="none" />
    <circle cx="14" cy="12" r="1.75" fill="currentColor" stroke="none" />
    <circle cx="10" cy="18" r="1.75" fill="currentColor" stroke="none" />
  </svg>
)

export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v11M7 10l5 5 5-5M4 19h16" />
  </svg>
)

export const WindowsIcon = (p: IconProps) => (
  <svg {...base({ ...p, stroke: 'none', fill: 'currentColor' })}>
    <path d="M3 5.5l7.5-1v7H3zM11.5 4.3L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
  </svg>
)

export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const ArrowRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

export const GitHubIcon = (p: IconProps) => (
  <svg {...base({ ...p, stroke: 'none', fill: 'currentColor' })}>
    <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.13-4.56-5.05 0-1.12.39-2.03 1.03-2.74-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.04a9.3 9.3 0 015 0c1.91-1.32 2.75-1.04 2.75-1.04.55 1.4.2 2.44.1 2.7.64.71 1.03 1.62 1.03 2.74 0 3.93-2.34 4.79-4.57 5.04.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.24 10.24 0 0022 12.23C22 6.58 17.52 2 12 2z" />
  </svg>
)
