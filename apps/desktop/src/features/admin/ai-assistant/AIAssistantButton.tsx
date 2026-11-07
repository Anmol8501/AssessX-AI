import { useEffect, useState } from 'react'
import { AIAssistantPanel } from './AIAssistantPanel'
import { Robot3DCanvas } from './Robot3DCanvas'

const POP_PROMPTS = [
  'Hello! 👋',
  'May I help you? ✨',
  'Need questions drafted? 📝',
  'Ask me to design an exam! 🚀',
]

export function AIAssistantButton() {
  const [open, setOpen] = useState(false)
  const [promptIndex, setPromptIndex] = useState(0)
  const [bubbleVisible, setBubbleVisible] = useState(true)

  // Cycle prompt messages every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setPromptIndex((prev) => (prev + 1) % POP_PROMPTS.length)
    }, 5000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <div className="fixed bottom-6 right-6 z-30 flex flex-col items-end pointer-events-none select-none">
        {/* Floating Pop-out Speech Bubble */}
        {!open && bubbleVisible && (
          <div className="pointer-events-auto relative mb-1 mr-3 flex items-center gap-2 rounded-2xl bg-card/95 border border-line-strong/80 px-4 py-2 text-[13px] font-semibold text-ink shadow-2xl backdrop-blur-md transition-all duration-300 animate-bounce">
            <span className="text-accent text-sm">✦</span>
            <span className="whitespace-nowrap tracking-tight text-ink">
              {POP_PROMPTS[promptIndex]}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setBubbleVisible(false)
              }}
              className="ml-1 text-ink-subtle hover:text-ink text-[12px] p-0.5 leading-none transition-colors"
              title="Close"
              aria-label="Close speech bubble"
            >
              ✕
            </button>
            {/* Speech bubble pointer tail */}
            <div className="absolute -bottom-1.5 right-8 h-3 w-3 rotate-45 border-b border-r border-line-strong/80 bg-card/95" />
          </div>
        )}

        {/* Real 3D Mascot Bot in Motion (NO CIRCLE, NO BORDER) */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="pointer-events-auto relative flex items-center justify-center bg-transparent border-none p-0 cursor-pointer transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none"
          title="Click to chat with AI Assistant"
          aria-label="Open AI Assistant"
        >
          {/* Subtle soft shadow underneath the 3D model */}
          <div className="absolute -bottom-1 w-16 h-3 bg-black/15 rounded-full blur-sm scale-90 animate-pulse pointer-events-none" />

          {/* Interactive WebGL 3D Robot Canvas */}
          <Robot3DCanvas className="h-24 w-24 cursor-pointer" />
        </button>
      </div>

      <AIAssistantPanel isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
