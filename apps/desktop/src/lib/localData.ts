/**
 * Candidate data the app keeps on the machine during an exam, so nothing is lost if the network drops:
 * code and interview-answer drafts, proctoring events not yet delivered, the AI's open observations.
 *
 * Exam PCs are often shared (a lab, a library). So this data is removed when it has done its job
 * (Phase 8B, BX-12): an exam's own entries when that exam finishes, and every entry when the user signs
 * out. A session merely *expiring* during an exam keeps it — the candidate signs in again and carries on
 * without losing unsaved work.
 */
const EXAM_PREFIXES = [
  'assessx.coding-draft.',
  'assessx.interview-draft.',
  'assessx.ai-open-episodes.',
  'assessx.proctoring-events.',
]

function keys(storage: Storage): string[] {
  const found: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key) found.push(key)
  }
  return found
}

/** Removes the local exam data of one attempt (or of every attempt when `attemptId` is omitted). */
export function clearExamLocalData(attemptId?: string): number {
  let removed = 0
  try {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of keys(storage)) {
        if (!EXAM_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
        if (attemptId && !key.includes(attemptId)) continue
        storage.removeItem(key)
        removed++
      }
    }
  } catch {
    // Storage unavailable (blocked by policy): there is nothing to clear.
  }
  return removed
}
