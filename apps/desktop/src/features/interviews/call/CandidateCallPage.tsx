import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { Button } from '@/components/ui'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import { describeError } from '../useInterviews'
import { CallMessage, CallScreen, ChatPanel } from './CallScreen'
import type { CandidateCall } from './types'
import { useCall } from './useCall'

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ended' } | { status: 'ready'; call: CandidateCall }

/**
 * The candidate's side of a live interview (Phase 7D), full-screen. Joining is recorded by the server;
 * then the call connects. The candidate can leave and rejoin while it is open; only the interviewer ends
 * it. The candidate never receives the interviewer's notes or the question guide.
 */
export function CandidateCallPage() {
  const { interviewId = '', callId = '' } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let active = true
    api<CandidateCall>(`/api/v1/candidates/me/interview-calls/${callId}/join`, { method: 'POST' })
      .then((call) => active && setLoad({ status: 'ready', call }))
      .catch((error: unknown) => {
        if (!active) return
        setLoad(error instanceof ApiError && error.code === 'call_ended' ? { status: 'ended' } : { status: 'error', message: describeError(error, 'Could not join the call.') })
      })
    return () => {
      active = false
    }
  }, [api, callId])

  const leave = () => navigate(routes.candidate.interviewDetail(interviewId))

  if (load.status === 'loading') return <CallMessage title="Joining the call…" />
  if (load.status === 'ended') return <Ended onBack={leave} />
  if (load.status === 'error') {
    return (
      <CallMessage title="Could not join the call">
        <p className="text-[13px] text-gray-400">{load.message}</p>
        <Button variant="secondary" onClick={leave}>
          Back
        </Button>
      </CallMessage>
    )
  }
  return <LiveCandidateCall record={load.call} onLeave={leave} />
}

function Ended({ onBack }: { onBack(): void }) {
  return (
    <CallMessage title="The interviewer has ended the call">
      <p className="text-[13px] text-gray-400">Thank you for your time. Nothing from the call was recorded.</p>
      <Button variant="secondary" onClick={onBack}>
        Back to the interview
      </Button>
    </CallMessage>
  )
}

function LiveCandidateCall({ record, onLeave }: { record: CandidateCall; onLeave(): void }) {
  const call = useCall(record.call_id, 'candidate', record.messages, true)

  if (call.phase === 'ended' || call.phase === 'unavailable') return <Ended onBack={onLeave} />
  if (call.phase === 'occupied') {
    return (
      <CallMessage title="You are already in this call on another screen">
        <Button variant="secondary" onClick={onLeave}>
          Back
        </Button>
      </CallMessage>
    )
  }

  return (
    <CallScreen
      call={call}
      role="candidate"
      title={record.interview_title}
      subtitle={`Live interview with ${record.interviewer_name} · not recorded`}
      openedAt={record.opened_at}
      plannedMinutes={record.planned_minutes}
      peerName={record.interviewer_name}
      endControl={
        <Button variant="danger" onClick={onLeave}>
          Leave
        </Button>
      }
      panel={
        <>
          <p className="border-b border-gray-800 px-3 py-2.5 text-[13px] font-medium">Chat</p>
          <ChatPanel messages={call.messages} role="candidate" onSend={call.sendChat} disabled={call.phase === 'reconnecting' || call.phase === 'connecting'} />
        </>
      }
    />
  )
}
