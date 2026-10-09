/**
 * What the candidate is told about recording before a proctored exam (PRD NFR-005: consent and clear
 * communication). Built from the server's own policy, so the words always match what is done.
 */
import type { RecordingPolicy } from '@/features/assessments/types'

export const NO_RECORDING_NOTICE =
  'Nothing from your camera or microphone is recorded or uploaded. An exam supervisor may view your camera live during the exam, and AssessX records events such as leaving the exam window — never video or audio. Both stay on while you take the exam and are switched off when it ends.'

export function recordingNotice(policy: RecordingPolicy | undefined | null): string {
  if (!policy?.enabled) return NO_RECORDING_NOTICE
  const days = policy.retention_days === 1 ? '1 day' : `${policy.retention_days} days`
  return (
    'Your microphone is never recorded, and your camera is not recorded continuously. When the camera shows ' +
    'certain things — your face out of view, another person, your head turned away, or a phone or other ' +
    `device — AssessX keeps a short video clip, without sound, from about ${policy.pre_seconds} seconds before to ` +
    `${policy.post_seconds} seconds after that moment, for an exam supervisor to review. A clip is not a decision ` +
    `about you: a person reviews it. Clips are stored privately and deleted after ${days}. An exam supervisor ` +
    'may also view your camera live during the exam, and AssessX records events such as leaving the exam window. ' +
    'Your camera and microphone are switched off when the exam ends.'
  )
}
