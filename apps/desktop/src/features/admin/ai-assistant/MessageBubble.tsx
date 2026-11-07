import { cn } from '@/lib/cn'
import type { ChatMessage } from './types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'USER'

  // Strip raw ```json CREATE_EXAM ... ``` from chat bubble for clean reading
  let cleanContent = message.content
  if (!isUser) {
    cleanContent = cleanContent
      .replace(/```json\s*\{[\s\S]*?"action"\s*:\s*"CREATE_EXAM"[\s\S]*?\}\s*```/g, '')
      .trim()
    if (!cleanContent) {
      cleanContent =
        'I have prepared the examination according to your specifications. You can review the details below and confirm to create it as a draft.'
    }
  }

  return (
    <div className={cn('flex w-full flex-col', isUser ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] text-ink-subtle">
        {!isUser && (
          <img
            src="/ai-bot.jpg"
            alt=""
            className="h-4 w-4 rounded-full object-cover inline-block mr-0.5 mix-blend-multiply"
          />
        )}
        <span>{isUser ? 'You' : 'AssessX AI'}</span>
        <span>·</span>
        <span className="tabular-nums">
          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div
        className={cn(
          'max-w-[92%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm',
          isUser
            ? 'bg-accent text-white rounded-br-none'
            : 'bg-card border border-line text-ink rounded-bl-none shadow-sm',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{cleanContent}</p>
        ) : (
          <RichMessageContent content={cleanContent} />
        )}
      </div>
    </div>
  )
}

function RichMessageContent({ content }: { content: string }) {
  // Parse blocks: code blocks, headings, options, horizontal dividers, paragraphs
  const blocks = splitIntoBlocks(content)

  return (
    <div className="space-y-3">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <div key={idx} className="my-2 overflow-hidden rounded-lg border border-line-strong bg-[#1e293b] shadow-sm">
              <div className="flex items-center justify-between border-b border-white/10 bg-[#0f172a] px-3 py-1.5 text-[11px] font-mono text-ink-inverse-muted">
                <span className="uppercase font-semibold tracking-wider text-accent-ring">
                  {block.language || 'code'}
                </span>
                <span>snippet</span>
              </div>
              <pre className="overflow-x-auto p-3 text-[12.5px] font-mono leading-relaxed text-[#f8fafc]">
                <code>{block.text}</code>
              </pre>
            </div>
          )
        }

        if (block.type === 'heading') {
          return (
            <div key={idx} className="pt-2 first:pt-0">
              <h4 className="flex items-center gap-2 font-semibold text-ink text-[14px] border-b border-line/60 pb-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft text-accent text-[11px] font-bold">
                  Q
                </span>
                <span>{renderInline(block.text)}</span>
              </h4>
            </div>
          )
        }

        if (block.type === 'option') {
          const isCorrect = block.isCorrect
          return (
            <div
              key={idx}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border p-2 text-[12.5px] transition-colors',
                isCorrect
                  ? 'border-ok/40 bg-ok-soft/30 text-ink'
                  : 'border-line/60 bg-card-muted/30 text-ink-muted',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold',
                  isCorrect ? 'bg-ok text-white' : 'bg-line text-ink-muted',
                )}
              >
                {block.label}
              </span>
              <div className="flex-1 min-w-0">
                <span>{renderInline(block.text)}</span>
                {isCorrect && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-ok/10 px-2 py-0.5 text-[10.5px] font-semibold text-ok">
                    Correct Answer ✓
                  </span>
                )}
              </div>
            </div>
          )
        }

        if (block.type === 'hr') {
          return <hr key={idx} className="my-2 border-line/80" />
        }

        return (
          <p key={idx} className="whitespace-pre-wrap leading-relaxed">
            {renderInline(block.text)}
          </p>
        )
      })}
    </div>
  )
}

type Block =
  | { type: 'code'; language: string; text: string }
  | { type: 'heading'; text: string }
  | { type: 'option'; label: string; text: string; isCorrect: boolean }
  | { type: 'hr' }
  | { type: 'paragraph'; text: string }

function splitIntoBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line === undefined) {
      i++
      continue
    }

    const trimmed = line.trim()

    // Code block check
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim()
      i++
      const codeLines: string[] = []
      while (i < lines.length) {
        const cur = lines[i]
        if (cur === undefined || cur.trim().startsWith('```')) break
        codeLines.push(cur)
        i++
      }
      i++ // skip closing ```
      blocks.push({ type: 'code', language, text: codeLines.join('\n') })
      continue
    }

    // Heading check (### Question X or **Question X**)
    if (trimmed.startsWith('###')) {
      blocks.push({ type: 'heading', text: line.replace(/^###\s*/, '') })
      i++
      continue
    }

    // Divider check
    if (trimmed === '---' || trimmed === '***') {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // Multiple Choice Option check (e.g., * A) ..., * B) ..., - A) ...)
    const optionMatch = line.match(/^[\s*-]*([A-D])[).:]\s*(.+)$/i)
    if (optionMatch && optionMatch[1] && optionMatch[2]) {
      const label = optionMatch[1].toUpperCase()
      let rawText = optionMatch[2]
      const isCorrect = /\*(Correct|Answer)\*|\(Correct\)|\(Answer\)/i.test(rawText)
      rawText = rawText.replace(/\*\(Correct\)\*|\(Correct\)|\*(Answer)\*|\(Answer\)/gi, '').trim()
      blocks.push({ type: 'option', label, text: rawText, isCorrect })
      i++
      continue
    }

    // Regular text paragraph collection
    if (trimmed === '') {
      i++
      continue
    }

    const paraLines: string[] = []
    while (i < lines.length) {
      const cur = lines[i]
      if (cur === undefined) break
      const curTrimmed = cur.trim()
      if (
        curTrimmed === '' ||
        curTrimmed.startsWith('```') ||
        curTrimmed.startsWith('###') ||
        curTrimmed === '---' ||
        cur.match(/^[\s*-]*([A-D])[).:]\s*(.+)$/i)
      ) {
        break
      }
      paraLines.push(cur)
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') })
    }
  }

  return blocks
}

function renderInline(text: string): React.ReactNode {
  // Parse bold (**...**) and inline code (`...`)
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-card-muted/80 px-1.5 py-0.5 font-mono text-[12px] font-medium text-accent border border-line"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    return part
  })
}
