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

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:8000'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as ApiErrorBody).error?.code === 'string'
}

export async function apiRequest<T>(path: string, { method = 'GET', body, token, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
