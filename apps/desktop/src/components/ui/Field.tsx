import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { EyeIcon, EyeOffIcon } from '@/components/icons'
import { cn } from '@/lib/cn'

interface FieldProps {
  label: string
  /** Rendered under the control; replaced by `error` when present. */
  hint?: string
  error?: string
  /** Optional element rendered on the label row's right (e.g. "Forgot password?"). */
  labelAction?: ReactNode
  children: (control: { id: string; describedBy?: string; invalid: boolean }) => ReactNode
}

/** Wires label, hint and error text to a form control with the right ARIA attributes. */
export function Field({ label, hint, error, labelAction, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-ink text-[13px] font-medium">
          {label}
        </label>
        {labelAction}
      </div>
      {children({ id, describedBy: message ? messageId : undefined, invalid: Boolean(error) })}
      {message && (
        <p id={messageId} className={cn('text-[12.5px]', error ? 'text-danger' : 'text-ink-subtle')} role={error ? 'alert' : undefined}>
          {message}
        </p>
      )}
    </div>
  )
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

const inputClasses = (invalid?: boolean, className?: string) =>
  cn(
    'h-10 w-full rounded-md border bg-card px-3 text-[14px] text-ink placeholder:text-ink-subtle/80 transition-colors',
    'focus:outline-none focus:ring-2',
    invalid
      ? 'border-danger focus:border-danger focus:ring-red-100'
      : 'border-line-strong hover:border-ink-subtle focus:border-accent focus:ring-accent-ring',
    'disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-subtle',
    className,
  )

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={inputClasses(invalid, className)} {...rest} />
})

/** Password input with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(function PasswordInput(
  { invalid, className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        className={inputClasses(invalid, cn('pr-10', className))}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="text-ink-subtle hover:text-ink absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? <EyeOffIcon className="text-[18px]" /> : <EyeIcon className="text-[18px]" />}
      </button>
    </div>
  )
})

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
}

export function Checkbox({ label, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn('text-ink-muted inline-flex cursor-pointer items-center gap-2 text-[13.5px]', className)}>
      <input type="checkbox" className="accent-accent h-4 w-4 rounded border-line-strong" {...rest} />
      {label}
    </label>
  )
}
