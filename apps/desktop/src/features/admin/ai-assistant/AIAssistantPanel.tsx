import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRightIcon, RefreshIcon, SpinnerIcon } from '@/components/icons'
import { Button } from '@/components/ui'
import { ConfirmPublishDialog } from './ConfirmPublishDialog'
import { ExamDraftPreview } from './ExamDraftPreview'
import { MessageBubble } from './MessageBubble'
import { Robot3DCanvas } from './Robot3DCanvas'
import { useAiAssistant } from './useAiAssistant'

interface AIAssistantPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function AIAssistantPanel({ isOpen, onClose }: AIAssistantPanelProps) {
  const {
    conversation,
    loading,
    sending,
    confirming,
    error,
    createdAssessmentId,
    sendMessage,
    startNewConversation,
    confirmExam,
    clearError,
  } = useAiAssistant(isOpen)

  const [input, setInput] = useState('')
  const [createdDialogId, setCreatedDialogId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (createdAssessmentId) {
      setCreatedDialogId(createdAssessmentId)
    }
  }, [createdAssessmentId])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages, sending, conversation?.pending_exam])

  function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    void sendMessage(text)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  const messages = conversation?.messages ?? []

  return (
    <>
      <div
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-lg flex-col border-l border-line bg-card shadow-2xl transition-transform duration-300 ease-in-out sm:w-[460px]"
        role="dialog"
        aria-modal="true"
        aria-label="AssessX AI Assistant"
      >
        {/* Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center shrink-0">
              <Robot3DCanvas className="h-10 w-10" interactive={false} />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-ink leading-tight">AssessX AI Assistant</h2>
              <p className="text-[11.5px] text-ink-subtle leading-tight">Exam authoring & question generation</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void startNewConversation()}
              disabled={loading || sending}
              title="Start a fresh conversation"
              leadingIcon={<RefreshIcon />}
            >
              New Chat
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle hover:bg-hover hover:text-ink transition-colors"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Message area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && messages.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-ink-subtle">
              <SpinnerIcon className="text-[22px] text-accent mr-2" />
              <span className="text-[13px]">Connecting to AI Assistant…</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
              <div className="flex h-24 w-24 items-center justify-center mb-2">
                <Robot3DCanvas className="h-24 w-24" />
              </div>
              <h3 className="text-[15px] font-semibold text-ink">Design Exams with AI</h3>
              <p className="mt-1 max-w-xs text-[13px] text-ink-subtle">
                Tell me what exam you want to create. I can suggest questions, calculate marks, and format options for you.
              </p>
              <div className="mt-5 space-y-2 w-full text-left">
                <p className="text-[11.5px] font-medium uppercase tracking-wider text-ink-subtle px-1">
                  Example prompts:
                </p>
                {[
                  'Create a 5-question Python basics quiz with 25 total marks.',
                  'Generate a Software Engineering MCQ exam for 60 minutes.',
                  'Draft 10 questions on Database normalization and SQL.',
                ].map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setInput(prompt)
                      inputRef.current?.focus()
                    }}
                    className="w-full rounded-lg border border-line bg-card-muted/40 p-2.5 text-[12.5px] text-ink hover:border-accent hover:bg-accent-muted/10 transition-colors"
                  >
                    "{prompt}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)
          )}

          {conversation?.has_pending_exam && conversation.pending_exam && (
            <ExamDraftPreview
              payload={conversation.pending_exam}
              confirming={confirming}
              onConfirm={() => void confirmExam()}
            />
          )}

          {sending && (
            <div className="flex items-center gap-2 text-ink-subtle text-[12.5px] px-1 py-1">
              <SpinnerIcon className="text-[16px] text-accent animate-spin" />
              <span>Thinking and drafting questions…</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[12.5px] text-danger flex items-start justify-between gap-2">
              <p className="leading-snug">{error}</p>
              <button
                type="button"
                onClick={clearError}
                className="shrink-0 text-danger hover:underline text-[11px] font-medium"
              >
                Dismiss
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Footer input */}
        <footer className="shrink-0 border-t border-line bg-card p-3">
          <div className="relative flex items-end rounded-xl border border-line-strong bg-card focus-within:border-accent focus-within:ring-1 focus-within:ring-accent transition-all">
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask AI to create or revise questions (Enter to send)…"
              className="w-full resize-none bg-transparent px-3 py-2 text-[13px] text-ink placeholder:text-ink-subtle focus:outline-none"
              disabled={sending}
            />
            <div className="pb-1.5 pr-1.5">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSend}
                disabled={!input.trim() || sending}
                loading={sending}
                className="h-8 w-8 !p-0 rounded-lg flex items-center justify-center"
                title="Send message"
              >
                {!sending && <ArrowRightIcon className="text-[15px]" />}
              </Button>
            </div>
          </div>
          <p className="mt-1.5 text-center text-[10.5px] text-ink-subtle">
            All AI-generated questions are created in DRAFT and must be verified before publishing.
          </p>
        </footer>
      </div>

      <ConfirmPublishDialog
        assessmentId={createdDialogId}
        onClose={() => setCreatedDialogId(null)}
      />
    </>
  )
}

