import { Card, CardBody, CardHeader, ComingSoon, InfoList, PageHeader } from '@/components/ui'
import { APP_VERSION } from '@/config/app'
import { API_BASE_URL } from '@/lib/api'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Application and organisation configuration." />

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

        <Card>
          <CardHeader title="Organisation" description="Security policies, users and retention." />
          <ComingSoon
            layout="inline"
            title="Organisation settings are not available yet"
            description="Organisation configuration arrives with the production foundation."
            phase="Phase 1C — Production Foundation"
          />
        </Card>
      </div>
    </>
  )
}
