import { useCallback, useEffect, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import type { ChatResponse, ConfirmExamResponse, Conversation } from './types'

export function useAiAssistant(isOpen: boolean) {
  const api = useApi()
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdAssessmentId, setCreatedAssessmentId] = useState<string | null>(null)

  const loadActiveConversation = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<Conversation | null>('/api/v1/admin/ai/conversations/active')
      setConversation(data)
      if (data?.created_assessment_id) {
        setCreatedAssessmentId(data.created_assessment_id)
      }
    } catch (err) {
      setError(describeError(err, 'Could not load active conversation.'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (isOpen) {
      void loadActiveConversation()
    }
  }, [isOpen, loadActiveConversation])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return

      setSending(true)
      setError(null)

      // Optimistic user message
      const optimisticId = `user-${Date.now()}`
      const optimisticMessage = {
        id: optimisticId,
        role: 'USER' as const,
        content: trimmed,
        created_at: new Date().toISOString(),
      }

      setConversation((prev) => {
        if (!prev) {
          return {
            id: 'temp',
            is_active: true,
            created_at: new Date().toISOString(),
            messages: [optimisticMessage],
            has_pending_exam: false,
          }
        }
        return {
          ...prev,
          messages: [...prev.messages, optimisticMessage],
        }
      })

      try {
        const res = await api<ChatResponse>('/api/v1/admin/ai/chat', {
          method: 'POST',
          body: {
            message: trimmed,
            conversation_id: conversation?.id && conversation.id !== 'temp' ? conversation.id : undefined,
          },
        })

        const assistantMessage = {
          id: `assistant-${Date.now()}`,
          role: 'ASSISTANT' as const,
          content: res.reply,
          created_at: new Date().toISOString(),
        }

        setConversation((prev) => {
          const messages = prev ? [...prev.messages, assistantMessage] : [optimisticMessage, assistantMessage]
          return {
            id: res.conversation_id,
            is_active: true,
            created_at: prev?.created_at ?? new Date().toISOString(),
            messages,
            has_pending_exam: res.has_pending_exam,
            pending_exam: res.pending_exam,
          }
        })
      } catch (err) {
        setError(describeError(err, 'Failed to send message.'))
        // Remove optimistic message on error
        setConversation((prev) => {
          if (!prev) return null
          return {
            ...prev,
            messages: prev.messages.filter((m) => m.id !== optimisticId),
          }
        })
      } finally {
        setSending(false)
      }
    },
    [api, conversation, sending],
  )

  const startNewConversation = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCreatedAssessmentId(null)
    try {
      const fresh = await api<Conversation>('/api/v1/admin/ai/conversations/new', { method: 'POST' })
      setConversation(fresh)
    } catch (err) {
      setError(describeError(err, 'Could not start a new conversation.'))
    } finally {
      setLoading(false)
    }
  }, [api])

  const confirmExam = useCallback(async () => {
    if (!conversation?.id || conversation.id === 'temp') return null

    setConfirming(true)
    setError(null)
    try {
      const res = await api<ConfirmExamResponse>(`/api/v1/admin/ai/conversations/${conversation.id}/confirm-exam`, {
        method: 'POST',
        body: { confirm: true },
      })
      setCreatedAssessmentId(res.assessment_id)
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              has_pending_exam: false,
              pending_exam: null,
              created_assessment_id: res.assessment_id,
            }
          : null,
      )
      return res.assessment_id
    } catch (err) {
      setError(describeError(err, 'Could not create the exam.'))
      return null
    } finally {
      setConfirming(false)
    }
  }, [api, conversation])

  return {
    conversation,
    loading,
    sending,
    confirming,
    error,
    createdAssessmentId,
    sendMessage,
    startNewConversation,
    confirmExam,
    clearError: () => setError(null),
  }
}

