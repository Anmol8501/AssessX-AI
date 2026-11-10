/**
 * Phase 3B: Examination Session Continuity, Answer Persistence & Recovery.
 *
 * Implements:
 * - Local-first encrypted answer persistence via Tauri commands with browser fallback
 * - Monotonic per-question revision sequence tracking
 * - Background batch synchronization with exponential backoff & jitter
 * - Real-time session heartbeat emitting and dropout detection
 * - Crash recovery detection & reconciliation handshake
 */

import { invoke } from '@tauri-apps/api/core'
import { apiRequest } from '@/lib/api'
import { tokenStorage } from '@/features/session'

export type SyncState = 'saved' | 'saving' | 'offline_saved' | 'error'

export interface AnswerSyncItem {
  question_id: string
  selected_option_ids: string[]
  client_revision: number
  idempotency_key: string
  client_timestamp: string
}

export interface AnswerSyncItemResult {
  question_id: string
  status: 'synced' | 'ignored_older_revision' | 'conflict'
  server_revision: number
  synced_at: string
  message?: string
}

export interface AnswerSyncBatchResponse {
  attempt_id: string
  results: AnswerSyncItemResult[]
  server_timestamp: string
}

export interface SessionHeartbeatResponse {
  attempt_id: string
  status: string
  server_timestamp: string
  remaining_seconds: number
  action_required: 'NONE' | 'REFRESH_SESSION' | 'TERMINATE'
}

export interface SessionRecoveryAnswerItem {
  question_id: string
  selected_option_ids: string[]
  server_revision: number
  updated_at: string
}

export interface SessionRecoveryResponse {
  attempt_id: string
  status: string
  resumable: boolean
  remaining_seconds: number
  server_answers: SessionRecoveryAnswerItem[]
  server_revision: number
  recovery_token: string
  server_timestamp: string
}

export interface LocalAnswerRecord {
  questionId: string
  selectedOptionIds: string[]
  clientRevision: number
  idempotencyKey: string
  clientTimestamp: string
  isSynced: boolean
  syncedAt?: string
}

export interface CrashRecoverySessionInfo {
  assessmentId?: string
  attemptId?: string
  candidateAccount: string
  sessionToken?: string
  lastHeartbeat: string
  restartCount: number
  isCleanExit: boolean
  crashDetected: boolean
  escalationRequired: boolean
}

export interface AttemptContinuitySummary {
  attempt_id: string
  candidate_id: string
  candidate_name: string
  status: string
  last_heartbeat_at: string | null
  seconds_since_heartbeat: number | null
  is_dropped_out: boolean
  device_id: string | null
  network_quality: string | null
  pending_sync_count: number
  last_synced_revision: number
  total_answers_synced: number
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
}

function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// ---------------------------------------------------------------------------
// Native Local Persistence Bridge (with Browser localStorage fallback)
// ---------------------------------------------------------------------------

export async function saveAnswerLocal(
  attemptId: string,
  questionId: string,
  selectedOptionIds: string[],
  clientRevision: number,
  idempotencyKey: string,
  clientTimestamp: string,
): Promise<LocalAnswerRecord> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<LocalAnswerRecord>('save_answer_local', {
        attemptId,
        questionId,
        selectedOptionIds,
        clientRevision,
        idempotencyKey,
        clientTimestamp,
      })
    } catch (err) {
      console.warn('[SessionContinuity] Native save_answer_local failed, falling back:', err)
    }
  }

  // Web Browser fallback
  const storageKey = `assessx:answers:${attemptId}`
  const existingRaw = localStorage.getItem(storageKey)
  const map: Record<string, LocalAnswerRecord> = existingRaw ? JSON.parse(existingRaw) : {}
  const record: LocalAnswerRecord = {
    questionId,
    selectedOptionIds,
    clientRevision,
    idempotencyKey,
    clientTimestamp,
    isSynced: false,
  }
  map[questionId] = record
  localStorage.setItem(storageKey, JSON.stringify(map))
  return record
}

export async function getAllLocalAnswers(attemptId: string): Promise<LocalAnswerRecord[]> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<LocalAnswerRecord[]>('get_all_local_answers', { attemptId })
    } catch (err) {
      console.warn('[SessionContinuity] Native get_all_local_answers failed, falling back:', err)
    }
  }

  const storageKey = `assessx:answers:${attemptId}`
  const existingRaw = localStorage.getItem(storageKey)
  if (!existingRaw) return []
  try {
    const map = JSON.parse(existingRaw) as Record<string, LocalAnswerRecord>
    return Object.values(map)
  } catch {
    return []
  }
}

export async function markLocalAnswersSynced(
  attemptId: string,
  questionIds: string[],
  syncedRevision: number,
): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('mark_local_answers_synced', {
        attemptId,
        questionIds,
        syncedRevision,
      })
      return
    } catch (err) {
      console.warn('[SessionContinuity] Native mark_local_answers_synced failed:', err)
    }
  }

  const storageKey = `assessx:answers:${attemptId}`
  const existingRaw = localStorage.getItem(storageKey)
  if (existingRaw) {
    try {
      const map = JSON.parse(existingRaw) as Record<string, LocalAnswerRecord>
      for (const qid of questionIds) {
        if (map[qid]) {
          map[qid].isSynced = true
          map[qid].syncedAt = new Date().toISOString()
        }
      }
      localStorage.setItem(storageKey, JSON.stringify(map))
    } catch {
      // ignore
    }
  }
}

export async function clearLocalAnswers(attemptId: string): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('clear_local_answers', { attemptId })
    } catch (err) {
      console.warn('[SessionContinuity] Native clear_local_answers failed:', err)
    }
  }
  localStorage.removeItem(`assessx:answers:${attemptId}`)
}

export async function getRecoverySessionState(): Promise<CrashRecoverySessionInfo | null> {
  if (isTauriEnvironment()) {
    try {
      return await invoke<CrashRecoverySessionInfo | null>('get_recovery_session_state')
    } catch (err) {
      console.warn('[SessionContinuity] Native get_recovery_session_state failed:', err)
    }
  }
  return null
}

export async function recordContinuityHeartbeat(attemptId: string): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      await invoke('record_continuity_heartbeat', { attemptId })
    } catch {
      // heartbeat tracking best effort
    }
  }
}

// ---------------------------------------------------------------------------
// Network Synchronization Manager (Batching, Exponential Backoff & Jitter)
// ---------------------------------------------------------------------------

export class SessionSyncManager {
  private attemptId: string
  private revisions: Map<string, number> = new Map()
  private pendingQueue: Map<string, AnswerSyncItem> = new Map()
  private inFlight = false
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private retryDelayMs = 1000
  private onStateChange: (questionId: string, state: SyncState) => void

  constructor(
    attemptId: string,
    initialRevisions: Record<string, number> = {},
    onStateChange: (questionId: string, state: SyncState) => void = () => {},
  ) {
    this.attemptId = attemptId
    this.onStateChange = onStateChange
    for (const [qid, rev] of Object.entries(initialRevisions)) {
      this.revisions.set(qid, rev)
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
    }
  }

  public destroy(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
    }
  }

  private handleOnline = (): void => {
    this.retryDelayMs = 1000
    void this.drainQueue()
  }

  public async recordAnswerChange(questionId: string, selectedOptionIds: string[]): Promise<void> {
    const currentRev = (this.revisions.get(questionId) ?? 0) + 1
    this.revisions.set(questionId, currentRev)

    const idempotencyKey = generateIdempotencyKey()
    const clientTimestamp = new Date().toISOString()

    // 1. Local-first persistence (survives crashes immediately)
    await saveAnswerLocal(
      this.attemptId,
      questionId,
      selectedOptionIds,
      currentRev,
      idempotencyKey,
      clientTimestamp,
    )

    // 2. Enqueue for remote sync
    const item: AnswerSyncItem = {
      question_id: questionId,
      selected_option_ids: selectedOptionIds,
      client_revision: currentRev,
      idempotency_key: idempotencyKey,
      client_timestamp: clientTimestamp,
    }

    this.pendingQueue.set(questionId, item)
    this.onStateChange(questionId, 'saving')

    // 3. Trigger queue drain
    void this.drainQueue()
  }

  public async drainQueue(): Promise<void> {
    if (this.inFlight || this.pendingQueue.size === 0) return
    this.inFlight = true

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }

    const items = Array.from(this.pendingQueue.values()).slice(0, 25)
    const questionIds = items.map((i) => i.question_id)

    try {
      const token = tokenStorage.get()

      const response = await apiRequest<AnswerSyncBatchResponse>(
        `/api/v1/candidates/me/attempts/${this.attemptId}/answers/sync`,
        {
          method: 'POST',
          token,
          body: {
            attempt_id: this.attemptId,
            answers: items,
          },
        },
      )

      // Mark successful results
      const syncedIds: string[] = []
      let maxRev = 0
      for (const res of response.results) {
        if (res.status === 'synced' || res.status === 'ignored_older_revision') {
          syncedIds.push(res.question_id)
          this.pendingQueue.delete(res.question_id)
          this.onStateChange(res.question_id, 'saved')
          if (res.server_revision > maxRev) maxRev = res.server_revision
        } else {
          this.onStateChange(res.question_id, 'error')
        }
      }

      if (syncedIds.length > 0) {
        await markLocalAnswersSynced(this.attemptId, syncedIds, maxRev)
      }

      this.retryDelayMs = 1000
    } catch {
      // Network failure or offline
      for (const qid of questionIds) {
        this.onStateChange(qid, 'offline_saved')
      }

      // Exponential backoff with jitter up to 15s
      const jitter = Math.random() * 500
      const delay = Math.min(this.retryDelayMs + jitter, 15000)
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 15000)

      this.retryTimeout = setTimeout(() => {
        void this.drainQueue()
      }, delay)
    } finally {
      this.inFlight = false
      if (this.pendingQueue.size > 0 && !this.retryTimeout) {
        void this.drainQueue()
      }
    }
  }

  public getPendingCount(): number {
    return this.pendingQueue.size
  }

  /** Highest client answer revision recorded in this sitting (0 if none). */
  public currentRevision(): number {
    let maxRev = 0
    for (const rev of this.revisions.values()) {
      if (rev > maxRev) maxRev = rev
    }
    return maxRev
  }

  /** Cancels backoff timers and flushes queued answers up to `timeoutMs` before submission. */
  public async flushAll(timeoutMs = 8000): Promise<{ pendingRemaining: number; flushed: boolean }> {
    const deadline = Date.now() + timeoutMs
    while (this.pendingQueue.size > 0 && Date.now() < deadline) {
      if (this.retryTimeout) {
        clearTimeout(this.retryTimeout)
        this.retryTimeout = null
      }
      if (!this.inFlight) {
        await this.drainQueue()
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (this.pendingQueue.size > 0 && this.retryTimeout) {
        // Give backoff a short pause or break if network stays offline past one immediate retry
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))))
      }
    }
    return {
      pendingRemaining: this.pendingQueue.size,
      flushed: this.pendingQueue.size === 0,
    }
  }
}

// ---------------------------------------------------------------------------
// Heartbeat & Continuity Monitor Loop
// ---------------------------------------------------------------------------

export interface HeartbeatOptions {
  attemptId: string
  deviceId?: string
  intervalMs?: number
  getPendingCount: () => number
  onActionRequired?: (action: 'REFRESH_SESSION' | 'TERMINATE') => void
  onRemainingTimeUpdate?: (seconds: number) => void
}

export function startHeartbeatMonitor(options: HeartbeatOptions): () => void {
  const {
    attemptId,
    deviceId = 'DESKTOP-APP',
    intervalMs = 20000,
    getPendingCount,
    onActionRequired,
    onRemainingTimeUpdate,
  } = options

  let active = true
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    if (!active) return

    try {
      const token = tokenStorage.get()

      // Keep native recovery timestamp fresh
      await recordContinuityHeartbeat(attemptId)

      const response = await apiRequest<SessionHeartbeatResponse>(
        `/api/v1/candidates/me/attempts/${attemptId}/heartbeat`,
        {
          method: 'POST',
          token,
          body: {
            attempt_id: attemptId,
            device_id: deviceId,
            client_timestamp: new Date().toISOString(),
            network_quality: navigator.onLine ? 'GOOD' : 'OFFLINE',
            pending_sync_count: getPendingCount(),
            last_synced_revision: 0,
          },
        },
      )

      if (active) {
        onRemainingTimeUpdate?.(response.remaining_seconds)
        if (response.action_required === 'TERMINATE' || response.action_required === 'REFRESH_SESSION') {
          onActionRequired?.(response.action_required)
        }
      }
    } catch {
      // Offline heartbeat failures are non-fatal
    } finally {
      if (active) {
        timer = setTimeout(tick, intervalMs)
      }
    }
  }

  timer = setTimeout(tick, 3000)

  return () => {
    active = false
    if (timer) clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Crash Recovery & Reconnection Handshake
// ---------------------------------------------------------------------------

export async function recoverExaminationSession(
  attemptId: string,
  deviceId = 'DESKTOP-APP',
): Promise<SessionRecoveryResponse> {
  const token = tokenStorage.get()

  return await apiRequest<SessionRecoveryResponse>(
    `/api/v1/candidates/me/attempts/${attemptId}/recover`,
    {
      method: 'POST',
      token,
      body: {
        attempt_id: attemptId,
        device_id: deviceId,
        crash_recovery_token: null,
        last_known_revision: 0,
      },
    },
  )
}

