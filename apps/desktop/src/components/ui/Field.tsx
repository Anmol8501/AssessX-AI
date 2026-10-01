import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
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

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

/** Multi-line text, styled like `Input`. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={inputClasses(invalid, cn('h-auto min-h-[84px] resize-y py-2 leading-relaxed', className))}
      {...rest}
    />
  )
})

export interface RadioOption<T extends string> {
  value: T
  label: string
  description?: string
}

interface RadioGroupProps<T extends string> {
  /** Accessible name for the group. */
  label: string
  name: string
  options: readonly RadioOption<T>[]
  value: T | null
  onChange(value: T): void
  disabled?: boolean
}

/** A labelled set of radio options, each with an optional description. */
export function RadioGroup<T extends string>({ label, name, options, value, onChange, disabled }: RadioGroupProps<T>) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-ink mb-1.5 text-[13px] font-medium">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] transition-colors',
            value === option.value ? 'border-accent bg-accent-soft/40' : 'border-line hover:border-line-strong',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="accent-accent mt-0.5 h-4 w-4"
          />
          <span className="min-w-0">
            <span className="text-ink block font-medium">{option.label}</span>
            {option.description && <span className="text-ink-subtle block text-[12px]">{option.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}
