import { LockIcon } from '@/components/icons'

/** Shown on builder sections that a published assessment freezes. */
export function LockedNotice() {
  return (
    <div className="border-line bg-surface text-ink-muted flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="status">
      <LockIcon className="text-ink-subtle mt-0.5 shrink-0 text-[15px]" />
      <span>
        This assessment is <strong className="text-ink font-medium">published</strong> and locked, so everyone
        assigned sees the same exam. Unpublish it from the Review step to edit again — possible only while no
        candidate is assigned.
      </span>
    </div>
  )
}
