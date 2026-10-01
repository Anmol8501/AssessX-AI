/**
 * Phase 7D live interview call shapes — `backend/app/schemas/interview_call.py`, field for field.
 *
 * The administrator's shape carries the interviewer's private notes; the candidate's shape does not have
 * the field at all, because the server never sends it. Nothing here holds media: the video is
 * peer-to-peer and nothing is recorded.
 */

export type CallStatus = 'OPEN' | 'ENDED'
/** Which side of the one-to-one call this screen is. */
export type CallRole = 'interviewer' | 'candidate'

export interface Person {
  id: string
  name: string
}

export interface ChatMessage {
  message_id: string
  sender: Person
  sender_role: 'INTERVIEWER' | 'CANDIDATE'
  body: string
  sent_at: string
}

export interface CallNote {
  note_id: string
  author: Person
  body: string
  created_at: string
  authored_by: 'HUMAN'
}

export interface CallSummary {
  call_id: string
  interview_id: string
  candidate_id: string
  status: CallStatus
  opened_by: Person
  opened_at: string
  candidate_joined_at: string | null
  ended_at: string | null
  ended_by: Person | null
  duration_seconds: number
}

export interface AdminCall extends CallSummary {
  interview_title: string
  planned_minutes: number
  candidate_name: string
  candidate_roll_number: string | null
  messages: ChatMessage[]
  notes: CallNote[]
}

export interface CandidateCall {
  call_id: string
  interview_id: string
  interview_title: string
  interviewer_name: string
  status: CallStatus
  opened_at: string
  ended_at: string | null
  planned_minutes: number
  messages: ChatMessage[]
}

/** What the other side says it is sending (their own toggles; not a measurement). */
export interface PeerMedia {
  audio: boolean
  video: boolean
  screen: boolean
}
