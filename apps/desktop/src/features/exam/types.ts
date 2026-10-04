/**
 * Wire shapes for the candidate's exam endpoints under `/api/v1/candidates/me`
 * (see `backend/app/schemas/attempt.py`).
 *
 * These are deliberately narrower than the admin shapes in `features/assessments/types.ts`:
 * there is no `is_correct` and no `explanation`, because the server does not send them to a
 * candidate. Do not widen them to match the admin types.
 */

import type { MyAssessment, QuestionNavigation, QuestionType } from '@/features/assessments/types'
import type { CodingProgress } from '@/features/coding/types'

/** An attempt is open, or it ended one of two ways. Both endings are final. */
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'TIME_EXPIRED'

/** Statuses that mean the attempt is finished and frozen. Mirrors the server's own set. */
export const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  'SUBMITTED',
  'TIME_EXPIRED',
])

export interface CandidateQuestionOption {
  id: string
  text: string
  position: number
}

export interface CandidateQuestion {
  id: string
  type: QuestionType
  text: string
  marks: number
  position: number
  options: CandidateQuestionOption[]
}

export interface AttemptAnswer {
  question_id: string
  selected_option_ids: string[]
  updated_at: string
}

/**
 * The authoritative clock for one attempt. Polled to resynchronise the countdown.
 *
 * `server_time` is the point of it: the client measures its own offset from the server once and
 * counts down against that, so winding the machine's clock changes only what the candidate sees,
 * never what the server enforces.
 */
/**
 * Exam control (exam rules): the server's tab-switch count and whether the exam is on hold (locked).
 * The second-to-last switch is the last warning; reaching `tab_switch_limit` locks the exam.
 */
export interface AttemptControl {
  tab_switches: number
  tab_switch_limit: number
  on_hold: boolean
  hold_reason: 'TAB_SWITCH_LIMIT' | 'ADMIN' | null
  held_at: string | null
  ended_by_admin: boolean
}

export interface AttemptSession {
  attempt_id: string
  status: AttemptStatus
  started_at: string
  expires_at: string
  submitted_at: string | null
  finalized_at: string | null
  server_time: string
  remaining_seconds: number
  control?: AttemptControl | null
}

/** An attempt with its paper, its answers and its clock — what a reload restores from. */
export interface AttemptDetail {
  id: string
  assessment_id: string
  assignment_id: string
  attempt_number: number
  max_attempts: number
  status: AttemptStatus
  started_at: string
  expires_at: string
  submitted_at: string | null
  finalized_at: string | null
  server_time: string
  remaining_seconds: number

  title: string
  instructions: string | null
  /** Shown for information only: Phase 3A has no timer and nothing enforces this. */
  duration_minutes: number
  total_marks: number
  question_navigation: QuestionNavigation

  questions: CandidateQuestion[]
  answers: AttemptAnswer[]

  /**
   * The attempt's proctoring session, or `null` when this attempt is not proctored. Fixed when the
   * attempt started, so a later change to the assessment's setting does not affect it.
   */
  proctoring: ProctoringSession | null
  /** Exam control: tab switches and whether the exam is on hold (locked). */
  control?: AttemptControl | null
  /** MCQ only, coding only or mixed — how the exam screen labels questions. */
  assessment_type?: 'MCQ' | 'CODING' | 'MIXED'
  /** Coding questions' progress (facts only, never a score). */
  coding?: CodingProgress[]
  /** Copy and paste are allowed inside the code editor (an assessment setting). */
  coding_allow_paste?: boolean
}

/** The proctoring session's lifecycle. One direction only; `ENDED` follows the attempt ending. */
export type ProctoringSessionStatus = 'NOT_STARTED' | 'ACTIVE' | 'ENDED'

/**
 * Device availability as the server records it. Availability only — never what the camera sees
 * or the microphone hears. The client's richer local states map onto these
 * (see `features/proctoring/devices.ts`).
 */
export type DeviceState = 'NOT_READY' | 'READY' | 'DENIED' | 'UNAVAILABLE'

/** Wire shape of `backend/app/schemas/proctoring.py::ProctoringSessionOut`. Every time is the server's. */
export interface ProctoringSession {
  id: string
  attempt_id: string
  status: ProctoringSessionStatus
  camera_state: DeviceState
  microphone_state: DeviceState
  started_at: string | null
  ended_at: string | null
  devices_reported_at: string | null
}

/** The exam details screen. The server decides whether the exam can be started, and says why not. */
export interface ExamDetail extends MyAssessment {
  attempts_used: number
  can_start: boolean
  start_blocked_reason: string | null
  /** The newest attempt, finished or not — how the final state is reached after submission. */
  latest_attempt_id: string | null
}

/** Whether the server has confirmed the answer currently shown for a question. */
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** The option ids the candidate has selected for one question. */
export type AnswerState = string[]

/**
 * How one question turned out. `UNANSWERED` is kept distinct from `INCORRECT` on purpose. `PARTIAL` is
 * a coding question with some of its marks (partial scoring).
 */
export type AnswerOutcome = 'CORRECT' | 'INCORRECT' | 'UNANSWERED' | 'PARTIAL'

export const OUTCOME_LABEL: Record<AnswerOutcome, string> = {
  CORRECT: 'Correct',
  INCORRECT: 'Incorrect',
  UNANSWERED: 'Unanswered',
  PARTIAL: 'Partly correct',
}

/** One question's contribution. Carries no answer key — see `backend/app/schemas/result.py`. */
export interface QuestionResult {
  position: number
  marks: number
  marks_awarded: number
  outcome: AnswerOutcome
  /** Coding questions carry their best submission's facts: tests passed of all tests (never which ones), its verdict and language. */
  kind: 'OBJECTIVE' | 'CODING'
  tests_passed: number | null
  tests_total: number | null
  verdict: string | null
  language: string | null
}

/** Coding assessments: questions with partial marks and the MCQ / coding section totals (null when the exam has no question of that kind). */
export interface ResultSections {
  partial_count: number | null
  mcq_score: number | null
  mcq_maximum: number | null
  coding_score: number | null
  coding_maximum: number | null
}

/**
 * A candidate's own result for one attempt.
 *
 * `released` mirrors the assessment's "show results" setting. When it is false the attempt has
 * still been evaluated — the administrator can see the score — but every number here is `null`,
 * so a withheld result can never be mistaken for a failed one.
 */
export interface CandidateResult extends ResultSections {
  attempt_id: string
  assessment_id: string
  assessment_title: string
  attempt_number: number
  attempt_status: AttemptStatus
  submitted_at: string | null
  finalized_at: string | null

  released: boolean
  score: number | null
  maximum_score: number | null
  percentage: string | null
  passed: boolean | null
  correct_count: number | null
  incorrect_count: number | null
  unanswered_count: number | null
  evaluated_at: string | null
  questions: QuestionResult[]
  /** The exam has ended but a code submission is still being judged; the result follows shortly. */
  evaluating: boolean
}

/** A row in the candidate's results list. Only released results appear. */
export interface ResultSummary extends ResultSections {
  attempt_id: string
  assessment_id: string
  assessment_title: string
  attempt_number: number
  attempt_status: AttemptStatus
  score: number
  maximum_score: number
  percentage: string
  passed: boolean
  correct_count: number
  incorrect_count: number
  unanswered_count: number
  evaluated_at: string
  submitted_at: string | null
}

/** One candidate's result as the administrator's table shows it. */
export interface AdminResult extends ResultSections {
  attempt_id: string
  candidate_id: string
  candidate_name: string
  candidate_email: string
  candidate_roll_number: string | null
  attempt_number: number
  attempt_status: AttemptStatus
  score: number
  maximum_score: number
  percentage: string
  passing_marks: number
  passed: boolean
  correct_count: number
  incorrect_count: number
  unanswered_count: number
  submitted_at: string | null
  evaluated_at: string
}

export interface AssessmentResults {
  assessment_id: string
  assessment_title: string
  total_marks: number
  passing_marks: number
  assigned_count: number
  results: AdminResult[]
}
