/**
 * Minimal typed HTTP client for the AssessX API.
 *
 * - Base URL comes from `VITE_API_BASE_URL` (defaults to the local backend).
 * - Attaches the bearer token when one is set.
 * - Normalises every failure into `ApiError` so screens can branch on `kind` / `code`
 *   instead of inspecting raw responses.
 */

export type ApiErrorKind = 'network' | 'http'

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(kind: ApiErrorKind, status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.code = code
    this.details = details
  }

  static network(): ApiError {
    return new ApiError('network', 0, 'network_error', 'Cannot reach the AssessX server. Check your connection and try again.')
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

/**
 * The API this build talks to. Development and test builds may fall back to the local API; a production
 * build never does (Phase 8B, BX-11) — the build itself refuses to run without an https VITE_API_BASE_URL
 * (vite.config.ts), and this throws rather than guess if one somehow arrives without it.
 */
export const API_BASE_URL: string = (() => {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')
  if (configured) return configured
  if (import.meta.env.DEV || import.meta.env.MODE === 'test' || import.meta.env.VITE_ALLOW_LOCAL_API === '1') return 'http://127.0.0.1:8000'
  throw new Error('This build of AssessX has no API address configured.')
})()

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as ApiErrorBody).error?.code === 'string'
}

export async function apiRequest<T>(path: string, { method = 'GET', body, token, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  // A Blob (an evidence clip's video) is sent as it is, with its own type; anything else as JSON.
  const raw = body instanceof Blob
  if (body !== undefined) headers['Content-Type'] = raw ? body.type || 'application/octet-stream' : 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw ApiError.network()
  }

  if (response.status === 204) return undefined as T

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    /* non-JSON body — handled below */
  }

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError('http', response.status, payload.error.code, payload.error.message, payload.error.details)
    }
    throw new ApiError('http', response.status, 'http_error', `The server returned an unexpected response (${response.status}).`)
  }
  return payload as T
}

/**
 * A binary response (an evidence clip's video), with the same error handling as `apiRequest`. The
 * bytes stay in memory and are shown through a `blob:` URL: no storage URL ever reaches the app.
 */
export async function apiBlob(path: string, { token, signal }: { token?: string | null; signal?: AbortSignal } = {}): Promise<Blob> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers, signal, cache: 'no-store' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw ApiError.network()
  }
  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      /* non-JSON body */
    }
    if (isApiErrorBody(payload)) {
      throw new ApiError('http', response.status, payload.error.code, payload.error.message, payload.error.details)
    }
    throw new ApiError('http', response.status, 'http_error', `The server returned an unexpected response (${response.status}).`)
  }
  return response.blob()
}

/** One page of a bounded list (Phase 8 final, CX-04): the rows, and where the next page starts (if any). */
export interface ApiPage<T> {
  items: T[]
  nextOffset: number | null
}

export async function apiPage<T>(path: string, { token, signal }: { token?: string | null; signal?: AbortSignal } = {}): Promise<ApiPage<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers, signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw ApiError.network()
  }
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    /* non-JSON body */
  }
  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError('http', response.status, payload.error.code, payload.error.message, payload.error.details)
    }
    throw new ApiError('http', response.status, 'http_error', `The server returned an unexpected response (${response.status}).`)
  }
  const next = response.headers.get('X-Next-Offset')
  return { items: (payload as T[]) ?? [], nextOffset: next !== null && /^\d+$/.test(next) ? Number(next) : null }
}
