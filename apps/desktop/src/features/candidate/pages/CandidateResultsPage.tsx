import { ComingSoon, PageHeader } from '@/components/ui'

export function CandidateResultsPage() {
  return (
    <>
      <PageHeader title="Results" description="Results your organisation has chosen to share with you." />
      <ComingSoon
        title="Results are not available yet"
        description="Results appear after you submit an assessment and it is processed."
        phase="Phase 3 — Exam Attempt"
      />
    </>
  )
}
