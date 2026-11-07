import { useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { ConfirmDialog } from '@/components/ui'

interface ConfirmPublishDialogProps {
  assessmentId: string | null
  onClose: () => void
}

export function ConfirmPublishDialog({ assessmentId, onClose }: ConfirmPublishDialogProps) {
  const navigate = useNavigate()

  if (!assessmentId) return null

  function handleGoToBuilder() {
    onClose()
    if (assessmentId) {
      navigate(routes.admin.assessmentDetail(assessmentId))
    }
  }

  return (
    <ConfirmDialog
      open={Boolean(assessmentId)}
      title="Exam Draft Created"
      description="The examination has been created in DRAFT status with all generated questions and validated marks. You can now review it in the Assessment Builder and publish when ready."
      confirmLabel="Open in Builder"
      cancelLabel="Stay in Chat"
      onConfirm={handleGoToBuilder}
      onCancel={onClose}
    />
  )
}

