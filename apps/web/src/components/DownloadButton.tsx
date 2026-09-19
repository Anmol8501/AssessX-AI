import { DOWNLOAD_AVAILABLE, DOWNLOAD_FILE_NAME, DOWNLOAD_URL } from '../config/download'
import { WindowsIcon } from './icons'

type DownloadButtonProps = {
  label?: string
  size?: 'md' | 'lg'
  className?: string
}

/**
 * The only component that reads the download configuration.
 * Renders a real link once DOWNLOAD_AVAILABLE is true; otherwise a
 * focusable, clearly disabled control so nothing links to a missing file.
 */
export function DownloadButton({
  label = 'Download for Windows',
  size = 'md',
  className = '',
}: DownloadButtonProps) {
  const classes = `btn btn-primary ${size === 'lg' ? 'btn-lg' : 'btn-md'} ${className}`
  const iconSize = size === 'lg' ? 18 : 16

  if (!DOWNLOAD_AVAILABLE) {
    return (
      <button
        type="button"
        className={classes}
        aria-disabled="true"
        title="The Windows installer has not been published yet."
        onClick={(e) => e.preventDefault()}
      >
        <WindowsIcon size={iconSize} />
        {label}
      </button>
    )
  }

  return (
    <a href={DOWNLOAD_URL} download={DOWNLOAD_FILE_NAME} className={classes}>
      <WindowsIcon size={iconSize} />
      {label}
    </a>
  )
}

/** Small caption shown beneath download buttons. */
export function DownloadCaption({ children }: { children: string }) {
  return (
    <p className="text-ink-subtle mt-3 text-sm">
      {children}
      {!DOWNLOAD_AVAILABLE && <span className="text-ink-subtle"> · Installer coming soon</span>}
    </p>
  )
}
