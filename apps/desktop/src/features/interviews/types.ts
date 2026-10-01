/**
 * Phase 7A interview shapes — `backend/app/schemas/interview.py`, field for field (snake_case, as the
 * assessment feature does).
 *
 * Admin shapes carry the evaluation metadata (`expected_concepts`, `competency`); the candidate shapes
 * do not have those fields at all, because the server never sends them. The app decides nothing: the
 * current question, the next one, the time left and the end of the interview all come from the server.
 * Phase 7A does not evaluate answers — there is no score anywhere in these types.
 */

export type InterviewType = 'TECHNICAL' | 'BEHAVIORAL' | 'MIXED'
/** Phase 7D. AI: the server-run text interview. LIVE: a video call with a human interviewer. */
export type InterviewFormat = 'AI' | 'LIVE'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type InterviewStatus = 'DRAFT' | 'PUBLISHED'
export type QuestionKind = 'PRIMARY' | 'FOLLOW_UP'
export type QuestionType = 'TECHNICAL' | 'BEHAVIORAL' | 'CONCEPTUAL' | 'SCENARIO'
export type SessionStatus = 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED'
export type CompletionReason = 'ALL_ANSWERED' | 'TIME_EXPIRED' | 'ENDED_BY_CANDIDATE'

export interface InterviewInput {
  title: string
  description: string | null
  instructions: string | null
  interview_type: InterviewType
  format: InterviewFormat
  difficulty: Difficulty
  topics: string[]
  duration_minutes: number
  question_count: number
  follow_ups_enabled: boolean
  max_follow_ups: number
  /** Phase 7B: `difficulty` is the maximum; min ≤ starting ≤ maximum. */
  adaptive_difficulty: boolean
  min_difficulty: Difficulty
  starting_difficulty: Difficulty
}

/** Defaults for a new interview's form. */
export const EMPTY_INTERVIEW: InterviewInput = {
  title: '',
  description: null,
  instructions: null,
  interview_type: 'TECHNICAL',
  format: 'AI',
  difficulty: 'MEDIUM',
  topics: [],
  duration_minutes: 30,
  question_count: 5,
  follow_ups_enabled: true,
  max_follow_ups: 2,
  adaptive_difficulty: false,
  min_difficulty: 'EASY',
  starting_difficulty: 'MEDIUM',
}

export interface InterviewSummary {
  id: string
  title: string
  interview_type: InterviewType
  format: InterviewFormat
  difficulty: Difficulty
  status: InterviewStatus
  duration_minutes: number
  question_count: number
  primary_question_count: number
  assignment_count: number
  created_at: string
  published_at: string | null
}

export interface InterviewQuestion {
  id: string
  kind: QuestionKind
  parent_question_id: string | null
  text: string
  question_type: QuestionType
  topic: string
  difficulty: Difficulty
  expected_concepts: string[]
  competency: string | null
  context: string | null
  time_limit_seconds: number | null
  position: number
  is_active: boolean
}

export interface QuestionInput {
  text: string
  question_type: QuestionType
  topic: string
  difficulty: Difficulty
  expected_concepts: string[]
  competency: string | null
  context: string | null
  time_limit_seconds: number | null
  is_active: boolean
}

export interface FollowUpInput {
  text: string
  expected_concepts: string[]
  time_limit_seconds: number | null
  is_active: boolean
}

export interface InterviewDetail extends InterviewInput {
  id: string
  status: InterviewStatus
  created_at: string
  updated_at: string
  published_at: string | null
  questions: InterviewQuestion[]
  eligible_question_count: number
  issues: { field: string; message: string }[]
}

export interface InterviewAssignment {
  candidate_id: string
  candidate_name: string
  candidate_email: string
  candidate_roll_number: string | null
  assigned_at: string
  session_id: string | null
  /** Phase 7D: the live call open with this candidate now, if any. */
  open_call_id: string | null
  session_status: SessionStatus
  completion_reason: CompletionReason | null
  started_at: string | null
  completed_at: string | null
  primary_answered: number
  primary_total: number
  follow_ups_answered: number
}

// -- candidate --------------------------------------------------------------------------------------

export interface MyInterview {
  interview_id: string
  title: string
  description: string | null
  interview_type: InterviewType
  format: InterviewFormat
  difficulty: Difficulty
  duration_minutes: number
  question_count: number
  /** LIVE interviews: the call the interviewer has open now, to join. */
  open_call_id: string | null
  session_id: string | null
  session_status: SessionStatus
  completion_reason: CompletionReason | null
}

export interface CandidateInterviewDetail extends MyInterview {
  instructions: string | null
  topics: string[]
  follow_ups_enabled: boolean
}

export interface CandidateQuestion {
  item_id: string
  kind: QuestionKind
  number: number
  text: string
  context: string | null
  topic: string
  difficulty: Difficulty
  question_type: QuestionType
  time_limit_seconds: number | null
  presented_at: string
}

export interface SessionState {
  session_id: string
  interview_id: string
  interview_title: string
  status: 'ACTIVE' | 'COMPLETED'
  completion_reason: CompletionReason | null
  server_time: string
  started_at: string
  expires_at: string
  completed_at: string | null
  remaining_seconds: number
  progress: { primary_total: number; primary_answered: number; follow_ups_answered: number }
  current: CandidateQuestion | null
  /** The last answer is being processed; the next question will follow. Never a score. */
  processing: boolean
}

// -- admin: evaluations (Phase 7B) --------------------------------------------------------------------

/** A validated AI evaluation — an assessment signal for a person to review, not a decision. */
export interface InterviewEvaluation {
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNAVAILABLE'
  failure_reason: string | null
  overall_score: number | null
  dimension_scores: Record<string, number> | null
  confidence: number | null
  present_concepts: string[]
  missing_concepts: string[]
  incorrect_points: string[]
  strengths: string[]
  evidence_quotes: string[]
  feedback: string | null
  flags: string[]
  provider: string
  model: string
  evaluator_version: string
  rubric_version: string
  prompt_version: string
  requested_at: string
  completed_at: string | null
}

/** Primary questions in their asked order, each followed by its follow-up — how the admin list reads. */
export function orderQuestions(questions: InterviewQuestion[]): { primary: InterviewQuestion; followUp: InterviewQuestion | null }[] {
  const followUps = new Map(questions.filter((q) => q.kind === 'FOLLOW_UP').map((q) => [q.parent_question_id, q]))
  return questions
    .filter((q) => q.kind === 'PRIMARY')
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((primary) => ({ primary, followUp: followUps.get(primary.id) ?? null }))
}

/** Comma- or newline-separated text → trimmed, de-duplicated (case-insensitively) list. */
export function parseList(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[,\n]/)) {
    const value = raw.trim()
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase())
      out.push(value)
    }
  }
  return out
}
