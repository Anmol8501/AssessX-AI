import { ComingSoon, PageHeader } from '@/components/ui'

export function AdminResultsPage() {
  return (
    <>
      <PageHeader title="Results" description="Review submissions, scores and integrity findings." />
      <ComingSoon
        title="Results are not available yet"
        description="Results appear once candidates can attempt and submit assessments."
        phase="Phase 3 — Exam Attempt"
      />
    </>
  )
}
