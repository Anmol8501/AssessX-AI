import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getWorkstationDeviceIdentifier } from '../sessionActivation'
import {
  clearLocalAnswers,
  getAllLocalAnswers,
  markLocalAnswersSynced,
  saveAnswerLocal,
  SessionSyncManager,
} from '../sessionContinuity'

describe('Phase 3B Session Continuity: Local Storage & Sync Manager', () => {
  const attemptId = 'test-attempt-3b-001'
  let mockStore: Record<string, string> = {}

  beforeAll(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      const storageMock = {
        getItem: (key: string) => mockStore[key] ?? null,
        setItem: (key: string, value: string) => {
          mockStore[key] = value
        },
        removeItem: (key: string) => {
          delete mockStore[key]
        },
        clear: () => {
          mockStore = {}
        },
      }
      Object.defineProperty(globalThis, 'localStorage', {
        value: storageMock,
        writable: true,
      })
    }
    if (typeof globalThis.sessionStorage === 'undefined') {
      const sessionMock = new Map<string, string>()
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: {
          getItem: (k: string) => sessionMock.get(k) ?? null,
          setItem: (k: string, v: string) => {
            sessionMock.set(k, v)
          },
          removeItem: (k: string) => {
            sessionMock.delete(k)
          },
          clear: () => {
            sessionMock.clear()
          },
        },
        writable: true,
      })
    }
  })

  beforeEach(() => {
    mockStore = {}
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('saves and retrieves answers from local buffer', async () => {
    const q1 = 'question-1'
    const q2 = 'question-2'

    await saveAnswerLocal(attemptId, q1, ['opt-a'], 1, 'idemp-1', '2026-11-09T10:00:00Z')
    await saveAnswerLocal(attemptId, q2, ['opt-b', 'opt-c'], 2, 'idemp-2', '2026-11-09T10:00:01Z')

    const records = await getAllLocalAnswers(attemptId)
    expect(records).toHaveLength(2)

    const r1 = records.find((r) => r.questionId === q1)
    expect(r1).toBeDefined()
    expect(r1?.selectedOptionIds).toEqual(['opt-a'])
    expect(r1?.clientRevision).toBe(1)
    expect(r1?.isSynced).toBe(false)

    const r2 = records.find((r) => r.questionId === q2)
    expect(r2).toBeDefined()
    expect(r2?.selectedOptionIds).toEqual(['opt-b', 'opt-c'])
    expect(r2?.clientRevision).toBe(2)
  })

  it('marks local answers as synced', async () => {
    const q1 = 'question-1'
    await saveAnswerLocal(attemptId, q1, ['opt-a'], 1, 'idemp-1', '2026-11-09T10:00:00Z')

    await markLocalAnswersSynced(attemptId, [q1], 1)

    const records = await getAllLocalAnswers(attemptId)
    expect(records[0]?.isSynced).toBe(true)
    expect(records[0]?.syncedAt).toBeDefined()
  })

  it('clears local answers upon exam completion', async () => {
    const q1 = 'question-1'
    await saveAnswerLocal(attemptId, q1, ['opt-a'], 1, 'idemp-1', '2026-11-09T10:00:00Z')
    expect(await getAllLocalAnswers(attemptId)).toHaveLength(1)

    await clearLocalAnswers(attemptId)
    expect(await getAllLocalAnswers(attemptId)).toHaveLength(0)
  })

  it('SessionSyncManager advances monotonic revisions on sequential edits', async () => {
    const states: Record<string, string> = {}
    const manager = new SessionSyncManager(attemptId, {}, (qid, state) => {
      states[qid] = state
    })

    const qid = 'question-rev-test'
    await manager.recordAnswerChange(qid, ['opt-1'])
    expect(['saving', 'offline_saved']).toContain(states[qid])

    const records1 = await getAllLocalAnswers(attemptId)
    expect(records1.find((r) => r.questionId === qid)?.clientRevision).toBe(1)

    await manager.recordAnswerChange(qid, ['opt-1', 'opt-2'])
    const records2 = await getAllLocalAnswers(attemptId)
    expect(records2.find((r) => r.questionId === qid)?.clientRevision).toBe(2)
    expect(manager.currentRevision()).toBe(2)

    manager.destroy()
  })

  it('tracks pending count, drains flushAll on sync success, and resolves fallback device id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          attempt_id: attemptId,
          results: [{ question_id: 'q-flush', status: 'synced', server_revision: 1 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const manager = new SessionSyncManager(attemptId, {}, () => {})
    await manager.recordAnswerChange('q-flush', ['opt-x'])
    const flushRes = await manager.flushAll(1500)
    expect(flushRes.flushed).toBe(true)
    expect(flushRes.pendingRemaining).toBe(0)
    expect(manager.getPendingCount()).toBe(0)
    expect(manager.currentRevision()).toBe(1)
    manager.destroy()
    fetchSpy.mockRestore()

    const devId = await getWorkstationDeviceIdentifier()
    expect(devId.length).toBeGreaterThanOrEqual(16)
  })
})
