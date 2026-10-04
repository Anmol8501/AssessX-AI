import type { CodingStatus } from '../types'

/**
 * Pure helpers for the candidate's coding page (stage C3), kept apart from React so they can be tested.
 */

interface LabelQuestion {
  id: string
  type: string
}

/**
 * How the exam screen names each question:
 * * MCQ only: Question 1, 2, 3…
 * * coding only: Problem 1, 2, 3…
 * * mixed: multiple-choice questions keep their position number (Question 1, Question 2), and coding
 *   problems are counted on their own (Coding 1, Coding 2), in the administrator's order.
 */
export function questionLabels(questions: LabelQuestion[], assessmentType: string | undefined): string[] {
  let coding = 0
  return questions.map((q, i) => {
    if (q.type !== 'CODING') return `Question ${i + 1}`
    coding += 1
    return assessmentType === 'CODING' ? `Problem ${coding}` : `Coding ${coding}`
  })
}

/** Short navigator text for a label: "3", or "C2" for the second coding problem of a mixed exam. */
export function shortLabel(label: string): string {
  const [word, number] = label.split(' ')
  return word === 'Coding' ? `C${number}` : (number ?? label)
}

export const CODING_STATUS_LABEL: Record<CodingStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  PENDING: 'Being checked',
  PASSED: 'Passed',
  NOT_PASSED: 'Not all tests passed',
}

// -- the local backup of a draft ---------------------------------------------------------------------------

export interface LocalDraft {
  language: string
  source: string
  /** The server revision this text was based on. */
  revision: number
  savedAt: number
}

export const draftKey = (attemptId: string, questionId: string) => `assessx.coding-draft.${attemptId}.${questionId}`

export function readLocalDraft(attemptId: string, questionId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(attemptId, questionId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && 'source' in parsed && 'language' in parsed) return parsed as LocalDraft
  } catch {
    /* unavailable or corrupt: the server copy is used */
  }
  return null
}

export function writeLocalDraft(attemptId: string, questionId: string, draft: LocalDraft): void {
  try {
    localStorage.setItem(draftKey(attemptId, questionId), JSON.stringify(draft))
  } catch {
    /* quota or private mode: the server copy still exists */
  }
}

export function clearLocalDraft(attemptId: string, questionId: string): void {
  try {
    localStorage.removeItem(draftKey(attemptId, questionId))
  } catch {
    /* nothing to clear */
  }
}

/**
 * Which code to show when the page opens: the local backup when it is newer than the server's draft (it
 * holds edits that had not reached the server, e.g. while offline), else the server's draft, else the
 * starter code for the first language.
 */
export function initialCode(
  server: { language: string; source: string; revision: number } | null,
  local: LocalDraft | null,
  starters: Record<string, string>,
  languages: string[],
): { language: string; source: string; revision: number; unsaved: boolean } {
  if (local && languages.includes(local.language) && (!server || local.revision >= server.revision) && local.source !== server?.source) {
    return { language: local.language, source: local.source, revision: server?.revision ?? 0, unsaved: true }
  }
  if (server && languages.includes(server.language)) return { ...server, unsaved: false }
  const language = languages[0] ?? 'python'
  return { language, source: starters[language] ?? '', revision: server?.revision ?? 0, unsaved: false }
}

/** A fresh idempotency key: a retried request with the same key returns the original run. */
export function newRequestKey(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export const isFinished = (status: string) => status === 'COMPLETED' || status === 'FAILED'
