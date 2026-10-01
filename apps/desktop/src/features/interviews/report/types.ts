/**
 * Phase 7C interview report and review — `backend/app/schemas/interview_report.py`, field for field.
 *
 * Provenance is part of the shape: `summary` and each question's `evaluation` are AI-generated signals;
 * `review` is human-authored. The app computes nothing authoritative — every figure is the server's.
 */

import type { CompletionReason, Difficulty, InterviewEvaluation, InterviewType, QuestionKind, QuestionType } from '../types'

export type ReviewStatus = 'UNREVIEWED' | 'IN_REVIEW' | 'REVIEWED'
export type ReviewOutcome = 'MEETS_EXPECTATIONS' | 'NEEDS_FURTHER_ASSESSMENT' | 'DOES_NOT_MEET_EXPECTATIONS' | 'INCONCLUSIVE'
export type AnswerState = 'NOT_ANSWERED' | 'EVALUATION_PENDING' | 'ANSWERED_NOT_EVALUATED' | 'EVALUATED'
export type EvaluationState = 'NONE' | 'PENDING' | 'PARTIAL' | 'COMPLETE'

export interface Person {
  id: string
  name: string
}

export interface ReportSummary {
  planned_primaries: number
  primaries_asked: number
  answered_primaries: number
  follow_ups_asked: number
  follow_ups_answered: number
  answered_total: number
  completion_percent: number
  duration_seconds: number
  evaluation_state: EvaluationState
  evaluated_primaries: number
  evaluated_total: number
  ai_score: number | null
  ai_score_partial: boolean
  dimension_means: Record<string, Record<string, number>>
  evaluator_versions: string[]
  rubric_versions: string[]
  models: string[]
  report_policy_version: string
  source: 'AI'
  note: string
}

export interface ReportTopic {
  topic: string
  asked: number
  answered: number
  evaluated: number
  ai_score: number | null
  common_missing: [string, number][]
}

export interface ReportQuestion {
  item_id: string
  sequence: number
  kind: QuestionKind
  number: number
  question_text: string
  context: string | null
  topic: string
  difficulty: Difficulty
  question_type: QuestionType
  expected_concepts: string[]
  competency: string | null
  selected_by: 'PLAN' | 'ADAPTIVE' | 'FALLBACK'
  presented_at: string
  answered_at: string | null
  answer_text: string | null
  answer_state: AnswerState
  evaluation: InterviewEvaluation | null
  review_mark: { mark: 'AGREE' | 'DISAGREE'; marked_by: Person; marked_at: string; authored_by: 'HUMAN' } | null
}

export interface TimelineEntry {
  sequence: number
  kind: QuestionKind
  number: number
  topic: string
  difficulty: Difficulty
  selected_by: 'PLAN' | 'ADAPTIVE' | 'FALLBACK'
  answer_state: AnswerState
  ai_score: number | null
  decision: { follow_up: boolean; difficulty_change: number; difficulty: string; reason: string; policy_version: string } | null
}

export interface ReviewDecision {
  revision: number
  outcome: ReviewOutcome
  outcome_description: string
  rationale: string
  decided_by: Person
  decided_at: string
  basis: {
    report_policy_version: string
    ai_score: number | null
    ai_score_partial: boolean
    evaluation_state: string
    evaluated_primaries: number
    answered_primaries: number
    planned_primaries: number
    evaluator_versions: string[]
    rubric_versions: string[]
  }
  authored_by: 'HUMAN'
}

export interface ReportReview {
  status: ReviewStatus
  version: number | null
  outcome: ReviewOutcome | null
  started_by: Person | null
  started_at: string | null
  completed_by: Person | null
  completed_at: string | null
  blocked_reason: 'INTERVIEW_IN_PROGRESS' | 'EVALUATIONS_PENDING' | null
  notes: { note_id: string; author: Person; body: string; created_at: string; authored_by: 'HUMAN' }[]
  decisions: ReviewDecision[]
  history: { action: string; actor: Person; occurred_at: string; details: Record<string, unknown> }[]
  outcome_options: { outcome: ReviewOutcome; description: string }[]
  authored_by: 'HUMAN'
  note: string
}

export interface InterviewReport {
  generated_at: string
  report_policy_version: string
  candidate: { id: string; name: string; email: string; roll_number: string | null }
  interview: {
    id: string
    title: string
    interview_type: InterviewType
    difficulty: Difficulty
    adaptive_difficulty: boolean
    min_difficulty: Difficulty
    starting_difficulty: Difficulty
    topics: string[]
    duration_minutes: number
    question_count: number
    follow_ups_enabled: boolean
    max_follow_ups: number
  }
  session: {
    id: string
    status: 'ACTIVE' | 'COMPLETED'
    completion_reason: CompletionReason | null
    started_at: string
    expires_at: string
    completed_at: string | null
    current_difficulty: Difficulty
    difficulty_changes: number
  }
  summary: ReportSummary
  topics: ReportTopic[]
  questions: ReportQuestion[]
  timeline: TimelineEntry[]
  review: ReportReview
  proctoring: { applicable: boolean; note: string }
}

export interface ReportQueueRow {
  session_id: string
  interview_id: string
  interview_title: string
  candidate_name: string
  candidate_roll_number: string | null
  session_status: 'ACTIVE' | 'COMPLETED'
  completion_reason: CompletionReason | null
  started_at: string
  completed_at: string | null
  answered: number
  evaluation_state: EvaluationState
  ai_score: number | null
  review_status: ReviewStatus
  review_outcome: ReviewOutcome | null
  reviewed_by: Person | null
  reviewed_at: string | null
}

export interface ReportQueue {
  counts: Record<ReviewStatus, number>
  items: ReportQueueRow[]
  next_cursor: string | null
  note: string
}
