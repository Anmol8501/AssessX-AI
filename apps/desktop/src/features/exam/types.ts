/**
 * Wire shapes for the candidate's exam endpoints under `/api/v1/candidates/me`
 * (see `backend/app/schemas/attempt.py`).
 *
 * These are deliberately narrower than the admin shapes in `features/assessments/types.ts`:
 * there is no `is_correct` and no `explanation`, because the server does not send them to a
 * candidate. Do not widen them to match the admin types.
 */

import type { MyAssessment, QuestionNavigation, QuestionType } from '@/features/assessments/types'

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
export interface AttemptSession {
  attempt_id: string
  status: AttemptStatus
  started_at: string
  expires_at: string
  submitted_at: string | null
  finalized_at: string | null
  server_time: string
  remaining_seconds: number
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

/** How one question turned out. `UNANSWERED` is kept distinct from `INCORRECT` on purpose. */
export type AnswerOutcome = 'CORRECT' | 'INCORRECT' | 'UNANSWERED'

export const OUTCOME_LABEL: Record<AnswerOutcome, string> = {
  CORRECT: 'Correct',
  INCORRECT: 'Incorrect',
  UNANSWERED: 'Unanswered',
}

/** One question's contribution. Carries no answer key — see `backend/app/schemas/result.py`. */
export interface QuestionResult {
  position: number
  marks: number
  marks_awarded: number
  outcome: AnswerOutcome
}

/**
 * A candidate's own result for one attempt.
 *
 * `released` mirrors the assessment's "show results" setting. When it is false the attempt has
 * still been evaluated — the administrator can see the score — but every number here is `null`,
 * so a withheld result can never be mistaken for a failed one.
 */
export interface CandidateResult {
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
}

/** A row in the candidate's results list. Only released results appear. */
export interface ResultSummary {
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
export interface AdminResult {
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
