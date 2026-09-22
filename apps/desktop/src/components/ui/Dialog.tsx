import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button'
import type { ButtonVariant } from './buttonStyles'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  confirmVariant?: ButtonVariant
  cancelLabel?: string
  /** Disables both actions and shows a spinner on confirm. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

/**
 * Confirmation dialog on top of the native `<dialog>` element, which gives focus trapping,
 * Escape handling and a top-layer backdrop for free.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
      onClick={(event) => {
        // Click on the backdrop (outside the panel) dismisses.
        if (event.target === ref.current && !busy) onCancel()
      }}
      className="border-line bg-card shadow-float m-auto w-full max-w-md rounded-lg border p-0 backdrop:bg-gray-900/40"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="px-6 pt-6 pb-5">
        <h2 id="confirm-dialog-title" className="text-ink text-[16px] font-semibold">
          {title}
        </h2>
        {description && <p className="text-ink-muted mt-1.5 text-[14px]">{description}</p>}
        {children}
      </div>
      <div className="border-line bg-surface flex justify-end gap-2 rounded-b-lg border-t px-6 py-3.5">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} loading={busy} autoFocus>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
