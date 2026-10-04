/**
 * Coding problems (coding assessments, stage C1) — `backend/app/schemas/coding.py`, field for field.
 *
 * Admin shapes carry hidden test cases and the reference solution. `CodingProblemForCandidate` is the only
 * shape a candidate (or the admin's preview) receives, and it has no field for either.
 */

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'
export type VersionStatus = 'DRAFT' | 'PUBLISHED'
export type Visibility = 'PUBLIC' | 'HIDDEN'

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' }

/** Suggested tags. Admins can type any other tag too. */
export const SUGGESTED_TAGS = [
  'Arrays',
  'Strings',
  'Sorting',
  'Searching',
  'Hashing',
  'Linked List',
  'Stack',
  'Queue',
  'Tree',
  'Graph',
  'Recursion',
  'Dynamic Programming',
  'Greedy',
  'Mathematics',
] as const

export interface Language {
  id: string
  name: string
  version: string
}

export interface Example {
  input: string
  output: string
  explanation: string | null
}

export interface TestCase {
  id: string
  position: number
  visibility: Visibility
  input: string
  expected_output: string
  weight: number
}

export interface Version {
  id: string
  problem_id: string
  version: number
  status: VersionStatus
  title: string
  difficulty: Difficulty
  tags: string[]
  statement: string
  constraints: string | null
  input_format: string | null
  output_format: string | null
  examples: Example[]
  languages: string[]
  starter_code: Record<string, string>
  time_limit_ms: number
  memory_limit_mb: number
  default_points: number
  partial_scoring: boolean
  reference_language: string | null
  reference_solution: string | null
  validated_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  test_cases: TestCase[]
  /** Why this draft cannot be published yet. */
  issues: string[]
}

export type VersionPatch = Partial<
  Pick<
    Version,
    | 'title'
    | 'difficulty'
    | 'tags'
    | 'statement'
    | 'constraints'
    | 'input_format'
    | 'output_format'
    | 'examples'
    | 'languages'
    | 'starter_code'
    | 'time_limit_ms'
    | 'memory_limit_mb'
    | 'default_points'
    | 'partial_scoring'
    | 'reference_language'
    | 'reference_solution'
  >
>

export interface VersionRef {
  id: string
  version: number
  status: VersionStatus
  title: string
  difficulty: Difficulty
  tags: string[]
  languages: string[]
  published_at: string | null
}

export interface ProblemSummary {
  id: string
  slug: string
  is_enabled: boolean
  created_at: string
  created_by: string
  latest: VersionRef | null
  draft: VersionRef | null
  used_in: number
}

export interface ProblemDetail extends ProblemSummary {
  versions: VersionRef[]
}

export interface CodingProblemForCandidate {
  title: string
  difficulty: Difficulty
  tags: string[]
  statement: string
  constraints: string | null
  input_format: string | null
  output_format: string | null
  examples: Example[]
  languages: Language[]
  starter_code: Record<string, string>
  time_limit_ms: number
  memory_limit_mb: number
  sample_tests: { number: number; input: string; expected_output: string }[]
  hidden_test_count: number
}

/** A run of code as administrators see it (validation): every test, hidden ones included. */
export interface AdminExecution {
  id: string
  kind: 'RUN' | 'SUBMIT' | 'VALIDATE'
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  verdict: string | null
  language: string
  passed: number | null
  total: number | null
  runtime_ms: number | null
  memory_kb: number | null
  compile_output: string | null
  results: { test_id: string; number: number; visibility: string; verdict: string; runtime_ms: number | null; stdout: string; stderr: string }[]
  created_at: string
  completed_at: string | null
}

export const VERDICT_LABEL: Record<string, string> = {
  ACCEPTED: 'Accepted',
  WRONG_ANSWER: 'Wrong answer',
  COMPILATION_ERROR: 'Compilation error',
  RUNTIME_ERROR: 'Runtime error',
  TIME_LIMIT_EXCEEDED: 'Time limit exceeded',
  MEMORY_LIMIT_EXCEEDED: 'Memory limit exceeded',
  OUTPUT_LIMIT_EXCEEDED: 'Output limit exceeded',
  COMPLETED: 'Completed',
  SYSTEM_ERROR: 'System error (not your code)',
}

/** Coding analytics for one assessment (stage C4). Facts from stored rows; percentages and averages are decimal strings. */
export interface CodingAnalytics {
  assessment_id: string
  questions: {
    question_id: string
    number: number
    coding_number: number
    title: string
    marks: number
    candidates_attempted: number
    submissions: number
    acceptance_rate: string | null
    solved_rate: string | null
    average_score: string | null
    average_runtime_ms: string | null
    languages: Record<string, number>
    common_failure: string | null
  }[]
  /** By name, never ranked. */
  candidates: {
    attempt_id: string
    candidate_name: string
    attempt_number: number
    problems_attempted: number
    submissions: number
    languages: string[]
    pass_rate: string | null
    coding_score: number | null
    coding_maximum: number | null
    problems: {
      question_id: string
      submissions: number
      best_verdict: string | null
      best_passed: number | null
      total: number | null
      marks: number | null
    }[]
  }[]
  summary: {
    results: number
    mcq_average: string | null
    mcq_maximum: number | null
    coding_average: string | null
    coding_maximum: number | null
    total_average: string | null
    total_maximum: number | null
  }
}

/** How a language is named on screen. Unknown ids are shown as they are. */
export const LANGUAGE_NAME: Record<string, string> = { python: 'Python', c: 'C', cpp: 'C++', java: 'Java' }

/** Comma-separated text → trimmed, de-duplicated (case-insensitively) tags. */
export function parseTags(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(',')) {
    const tag = raw.trim()
    if (tag && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag)
  }
  return out
}

/** The library row's headline version: the open draft first (what the admin is working on), else the latest. */
export function shownVersion(problem: ProblemSummary): VersionRef | null {
  return problem.draft ?? problem.latest
}

// -- the candidate's coding page (stage C3) ------------------------------------------------------------

export interface Draft {
  language: string
  source: string
  revision: number
  updated_at: string
}

export interface CandidateCodingQuestion {
  question_id: string
  marks: number
  problem: CodingProblemForCandidate
  allow_custom_input: boolean
  max_submissions: number
  submissions_used: number
  draft: Draft | null
}

export interface TestResult {
  number: number
  visibility: 'PUBLIC' | 'CUSTOM'
  verdict: string
  input: string
  expected_output: string | null
  stdout: string
  stderr: string
  runtime_ms: number | null
}

/** One hidden test as a candidate sees it: its number and verdict only — never its data or output. */
export interface HiddenResult {
  number: number
  verdict: string
}

/** How a hidden test's verdict reads: a pass is "Passed", anything else keeps its verdict name. */
export function hiddenVerdictLabel(verdict: string): string {
  return verdict === 'ACCEPTED' ? 'Passed' : (VERDICT_LABEL[verdict] ?? verdict)
}

/** A run or submission as its candidate sees it: sample tests in full, hidden tests as verdicts only. */
export interface Execution {
  id: string
  kind: 'RUN' | 'SUBMIT'
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  verdict: string | null
  language: string
  passed: number | null
  total: number | null
  runtime_ms: number | null
  memory_kb: number | null
  compile_output: string | null
  tests: TestResult[]
  hidden_passed: number | null
  hidden_total: number | null
  /** Submissions only: each hidden test's verdict, in order. */
  hidden_results: HiddenResult[]
  created_at: string
  completed_at: string | null
}

export interface SubmissionRow {
  id: string
  number: number
  language: string
  status: Execution['status']
  verdict: string | null
  passed: number | null
  total: number | null
  runtime_ms: number | null
  memory_kb: number | null
  created_at: string
}

export type CodingStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'PENDING' | 'PASSED' | 'NOT_PASSED'

export interface CodingProgress {
  question_id: string
  status: CodingStatus
  submissions: number
  best_passed: number | null
  total: number | null
}
