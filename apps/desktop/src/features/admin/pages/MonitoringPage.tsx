import { ComingSoon, PageHeader } from '@/components/ui'

export function MonitoringPage() {
  return (
    <>
      <PageHeader title="Monitoring" description="Live view of active exam sessions and proctoring events." />
      <ComingSoon
        title="Live monitoring is not available yet"
        description="Session monitoring depends on the proctoring layer and the live admin monitoring wall."
        phase="Phase 4–5 — Proctoring & Live Monitoring"
      />
    </>
  )
}
