import { ComingSoon, PageHeader } from '@/components/ui'

export function AssessmentsPage() {
  return (
    <>
      <PageHeader title="Assessments" description="Create exams, build question banks and configure exam settings." />
      <ComingSoon
        title="Assessment creation is not available yet"
        description="Exam creation, question management and configuration arrive with the next phase."
        phase="Phase 2 — Assessment Creation"
      />
    </>
  )
}
