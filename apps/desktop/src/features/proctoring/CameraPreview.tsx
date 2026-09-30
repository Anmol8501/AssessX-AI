import { useEffect, useRef } from 'react'
import { CameraIcon } from '@/components/icons'
import { cn } from '@/lib/cn'

interface CameraPreviewProps {
  stream: MediaStream | null
  className?: string
  /** Text shown in place of the picture when there is no stream. */
  placeholder?: string
}

/**
 * The candidate's own camera picture, shown only to them.
 *
 * Mirrored, as a self-view conventionally is. Nothing is captured from it: the element plays the
 * local stream and that is all.
 */
export function CameraPreview({ stream, className, placeholder = 'No camera picture' }: CameraPreviewProps) {
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = stream
    if (stream) void element.play().catch(() => undefined) // autoplay of a muted stream; failure is cosmetic
    return () => {
      element.srcObject = null
    }
  }, [stream])

  return (
    <div className={cn('bg-ink/90 relative overflow-hidden rounded-md', className)}>
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        aria-label="Your camera preview"
        className={cn('h-full w-full -scale-x-100 object-cover', !stream && 'invisible')}
      />
      {!stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12.5px] text-white/70">
          <CameraIcon className="text-[22px]" />
          {placeholder}
        </div>
      )}
    </div>
  )
}
