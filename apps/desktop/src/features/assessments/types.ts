/** Wire shapes for `/api/v1/assessments` (see `backend/app/schemas`). Mostly admin-only. */

// Type-only, so it is erased at compile time and the two modules do not form a runtime cycle.
import type { AttemptStatus } from '@/features/exam/types'

export type AssessmentStatus = 'DRAFT' | 'READY' | 'PUBLISHED'

export const STATUS_LABEL: Record<AssessmentStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  PUBLISHED: 'Published',
}

/** How a candidate may move through questions. Honoured by the exam screen. */
export type QuestionNavigation = 'FREE' | 'SEQUENTIAL'

export const NAVIGATION_LABEL: Record<QuestionNavigation, string> = {
  FREE: 'Free — candidates can go back and change an earlier answer',
  SEQUENTIAL: 'One-way — candidates move forward only and cannot return to a previous question',
}

export interface AssessmentSettings {
  max_attempts: number
  randomize_questions: boolean
  randomize_options: boolean
  show_results: boolean
  question_navigation: QuestionNavigation
  /** Phase 4A: candidates pass a camera/microphone check and sit the exam under a proctoring session. */
  proctoring_required: boolean
  availability_start: string | null
  availability_end: string | null
}

export interface ReadinessIssue {
  /** Which part of the builder the issue belongs to, e.g. `title` or `questions.<id>`. */
  field: string
  message: string
}

export interface ReadinessReport {
  is_ready: boolean
  issues: ReadinessIssue[]
}

export type QuestionType = 'MCQ' | 'MULTIPLE_SELECT' | 'TRUE_FALSE'

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MCQ: 'Multiple choice',
  MULTIPLE_SELECT: 'Multiple select',
  TRUE_FALSE: 'True / False',
}

/** Types that accept exactly one correct answer. Mirrors `SINGLE_ANSWER_TYPES` on the server. */
export const SINGLE_ANSWER_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>(['MCQ', 'TRUE_FALSE'])

export const TRUE_FALSE_OPTIONS = ['True', 'False'] as const
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 10

export interface QuestionOption {
  id: string
  text: string
  /** The answer key — admin-only. A candidate-facing shape must never include it (OQ-17). */
  is_correct: boolean
  position: number
}

export interface Question {
  id: string
  assessment_id: string
  type: QuestionType
  text: string
  marks: number
  position: number
  explanation: string | null
  options: QuestionOption[]
  created_at: string
  updated_at: string
}

export interface AssessmentSummary {
  id: string
  title: string
  description: string | null
  status: AssessmentStatus
  duration_minutes: number
  total_marks: number
  passing_marks: number
  /** How many questions exist. */
  question_count: number
  /** Sum of the questions' marks; readiness requires it to equal `total_marks`. */
  allocated_marks: number
  /** How many candidates hold this assessment. */
  assignment_count: number
  created_at: string
  updated_at: string
}

export interface AssessmentDetail extends AssessmentSummary {
  instructions: string | null
  settings: AssessmentSettings
  questions: Question[]
  readiness: ReadinessReport
}

export interface AssessmentInput {
  title: string
  description: string | null
  instructions: string | null
  duration_minutes: number
  total_marks: number
  passing_marks: number
}

/** A PATCH body: basic information, settings, or both. */
export type AssessmentPatch = Partial<AssessmentInput & AssessmentSettings>

export interface QuestionOptionInput {
  text: string
  is_correct: boolean
}

export interface QuestionInput {
  type: QuestionType
  text: string
  marks: number
  explanation: string | null
  options: QuestionOptionInput[]
}

/** Assignment status. The attempt has its own status — see `features/exam/types.ts`. */
export type AssignmentStatus = 'ASSIGNED'

export interface Assignment {
  id: string
  candidate_id: string
  candidate_name: string
  candidate_email: string
  candidate_roll_number: string | null
  status: AssignmentStatus
  assigned_at: string
}

export interface AssignmentResult {
  assigned: Assignment[]
  already_assigned: string[]
}

export interface CandidateSummary {
  id: string
  name: string
  email: string
  roll_number: string | null
  is_active: boolean
  assignment_count: number
  created_at: string
}

export interface CandidateInput {
  name: string
  email: string
  roll_number: string
  initial_password: string
}

/** A candidate's own view of an assigned assessment. Carries no questions or answer keys. */
export interface MyAssessment {
  assignment_id: string
  assessment_id: string
  title: string
  description: string | null
  instructions: string | null
  duration_minutes: number
  total_marks: number
  passing_marks: number
  question_count: number
  max_attempts: number
  /** Whether a new attempt will be proctored. A running attempt answers for itself (`AttemptDetail.proctoring`). */
  proctoring_required: boolean
  availability_start: string | null
  availability_end: string | null
  status: AssignmentStatus
  assessment_status: AssessmentStatus
  assigned_at: string
  /** The candidate's open attempt, if any. Non-null means Resume rather than Start. */
  active_attempt_id: string | null
  /** The newest attempt's state, so a card can say "Submitted" instead of offering a fresh start. */
  latest_attempt_status: AttemptStatus | null
}
