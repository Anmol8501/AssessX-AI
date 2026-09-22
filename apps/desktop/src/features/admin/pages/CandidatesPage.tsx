import { ComingSoon, PageHeader } from '@/components/ui'

export function CandidatesPage() {
  return (
    <>
      <PageHeader title="Candidates" description="Manage candidates and assign them to assessments." />
      <ComingSoon
        title="Candidate management is not available yet"
        description="Adding candidates and assigning them to exams arrives with assessment creation."
        phase="Phase 2 — Assessment Creation"
      />
    </>
  )
}
