export interface ChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  created_at: string
}

export interface PendingQuestionOption {
  text: string
  is_correct: boolean
}

export interface PendingQuestion {
  type: 'MCQ' | 'MULTIPLE_SELECT' | 'TRUE_FALSE'
  text: string
  marks: number
  explanation?: string | null
  options: PendingQuestionOption[]
}

export interface PendingAssessment {
  title: string
  assessment_type: 'MCQ' | 'MIXED'
  description?: string | null
  instructions?: string | null
  duration_minutes: number
  total_marks: number
  passing_marks: number
}

export interface PendingExamPayload {
  action: 'CREATE_EXAM'
  assessment: PendingAssessment
  questions: PendingQuestion[]
}

export interface Conversation {
  id: string
  is_active: boolean
  created_at: string
  messages: ChatMessage[]
  has_pending_exam: boolean
  pending_exam?: PendingExamPayload | null
  created_assessment_id?: string | null
}

export interface ChatResponse {
  conversation_id: string
  reply: string
  has_pending_exam: boolean
  pending_exam?: PendingExamPayload | null
}

export interface ConfirmExamResponse {
  assessment_id: string
  message: string
}
