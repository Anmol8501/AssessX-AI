import { ComingSoon, PageHeader } from '@/components/ui'

export function MyExamsPage() {
  return (
    <>
      <PageHeader title="My Exams" description="Assessments assigned to you, with instructions and start windows." />
      <ComingSoon
        title="Exams are not available yet"
        description="Assigned exams appear once administrators can create and assign assessments."
        phase="Phase 2–3 — Assessment Creation & Exam Attempt"
      />
    </>
  )
}
