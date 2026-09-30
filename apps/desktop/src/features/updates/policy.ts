/**
 * When the app may offer an update.
 *
 * Installing an update closes the app, so it is never offered while a candidate is on the exam
 * screen (`#/candidate/exams/<id>/attempt`); the prompt waits until they leave it. Everywhere else
 * — the welcome and sign-in screens, dashboards, the admin app — it may appear.
 */

/** First check shortly after start-up, so the app's own start is never slowed down. */
export const FIRST_CHECK_DELAY_MS = 4000
/** Re-check while the app stays open (e.g. an admin console left running all day). */
export const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function isExamRoute(hash: string): boolean {
  return /\/candidate\/exams\/[^/]+\/attempt(?:[/?#]|$)/.test(hash)
}
