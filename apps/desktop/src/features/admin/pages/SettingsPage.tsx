import { Card, CardBody, CardHeader, ComingSoon, InfoList, PageHeader } from '@/components/ui'
import { APP_VERSION } from '@/config/app'
import { SecureKioskCard } from '@/features/admin/SecureKioskCard'
import { ApplicationControlCard } from '@/features/admin/application-control/ApplicationControlCard'
import { DeviceReadinessCard } from '@/features/admin/provisioning/DeviceReadinessCard'
import { SecureShellManagerCard } from '@/features/admin/secure-shell/SecureShellManagerCard'
import { SecurityAgentManagerCard } from '@/features/admin/security-agent/SecurityAgentManagerCard'
import { SystemUtilityCard } from '@/features/admin/system-utility/SystemUtilityCard'
import { NavigationControlCard } from '@/features/admin/navigation-control/NavigationControlCard'
import { PeripheralControlCard } from '@/features/admin/peripheral-control/PeripheralControlCard'
import { ExamAuthorizationCard } from '@/features/admin/authorization/ExamAuthorizationCard'
import { AdminSessionContinuityCard } from '@/features/admin/monitoring/AdminSessionContinuityCard'
import { AdminSubmissionClosureCard } from '@/features/admin/monitoring/AdminSubmissionClosureCard'
import { API_BASE_URL } from '@/lib/api'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Application, hardware readiness and organisation configuration." />

      <div className="space-y-6">
        <DeviceReadinessCard />

        <SecureShellManagerCard />

        <SecurityAgentManagerCard />

        <ApplicationControlCard />

        <SystemUtilityCard />

        <NavigationControlCard />

        <PeripheralControlCard />

        <ExamAuthorizationCard />

        <AdminSessionContinuityCard />

        <AdminSubmissionClosureCard />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Application" />
            <CardBody>
              <InfoList
                items={[
                  { label: 'Version', value: `v${APP_VERSION}` },
                  { label: 'Platform', value: 'Windows desktop' },
                  { label: 'API endpoint', value: API_BASE_URL },
                ]}
              />
            </CardBody>
          </Card>

          <SecureKioskCard />

          <Card className="lg:col-span-2">
            <CardHeader title="Organisation" description="Security policies, users and retention." />
            <ComingSoon
              layout="inline"
              title="Organisation settings are not available yet"
              description="Organisation configuration arrives with the production foundation."
              phase="Phase 1C — Production Foundation"
            />
          </Card>
        </div>
      </div>
    </>
  )
}
