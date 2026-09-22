import { CandidatesIcon, ShieldIcon } from '@/components/icons'
import { cn } from '@/lib/cn'

export type AccountType = 'candidate' | 'admin'

const OPTIONS: Array<{ value: AccountType; label: string; icon: typeof ShieldIcon }> = [
  { value: 'candidate', label: 'Candidate', icon: CandidatesIcon },
  { value: 'admin', label: 'Administrator', icon: ShieldIcon },
]

interface AccountTypeSwitchProps {
  value: AccountType
  onChange(value: AccountType): void
  disabled?: boolean
}

/**
 * Chooses which sign-in form to show. This only selects the *form*; the backend still
 * decides the user's role from the account that actually authenticates.
 */
export function AccountTypeSwitch({ value, onChange, disabled }: AccountTypeSwitchProps) {
  return (
    <div role="tablist" aria-label="Account type" className="bg-surface border-line grid grid-cols-2 gap-1 rounded-lg border p-1">
      {OPTIONS.map(({ value: option, label, icon: Icon }) => {
        const active = option === value
        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(option)}
            className={cn(
              'flex h-9 items-center justify-center gap-2 rounded-md text-[13.5px] font-medium transition-colors',
              active ? 'bg-card text-ink shadow-card' : 'text-ink-subtle hover:text-ink',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            <Icon className={cn('text-[17px]', active ? 'text-accent' : 'text-ink-subtle')} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
