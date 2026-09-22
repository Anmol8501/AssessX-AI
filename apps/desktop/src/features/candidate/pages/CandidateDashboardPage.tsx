import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { useCurrentUser } from '@/features/session'

export function CandidateDashboardPage() {
  const user = useCurrentUser()

  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} description="Your upcoming and completed assessments." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming assessments" />
          <EmptyState title="No exams yet" description="Assessments assigned to you by your organisation will appear here." />
        </Card>

        <Card>
          <CardHeader title="Completed" />
          <EmptyState title="Nothing completed yet" description="Submitted assessments and permitted results will be listed here." />
        </Card>
      </div>
    </>
  )
}
