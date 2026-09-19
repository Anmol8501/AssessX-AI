/**
 * Single source of truth for the Windows installer download.
 *
 * To ship a real installer, either drop `AssessX-Setup.exe` into
 * `public/downloads/` or set VITE_ASSESSX_DOWNLOAD_URL to an external
 * release URL, then set VITE_ASSESSX_DOWNLOAD_AVAILABLE=true.
 * No component should reference the URL directly — import from here.
 */

const FALLBACK_DOWNLOAD_URL = '/downloads/AssessX-Setup.exe'

export const DOWNLOAD_URL: string =
  import.meta.env.VITE_ASSESSX_DOWNLOAD_URL?.trim() || FALLBACK_DOWNLOAD_URL

/** False until a real installer is published; gates every download button. */
export const DOWNLOAD_AVAILABLE: boolean =
  import.meta.env.VITE_ASSESSX_DOWNLOAD_AVAILABLE === 'true'

export const DOWNLOAD_FILE_NAME = 'AssessX-Setup.exe'

export const SUPPORTED_WINDOWS = 'Windows 10 / Windows 11'
