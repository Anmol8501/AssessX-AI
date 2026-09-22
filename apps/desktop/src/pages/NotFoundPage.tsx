import { Link } from 'react-router'
import { routes } from '@/app/routes'
import { AlertIcon } from '@/components/icons'
import { buttonClasses, StateView } from '@/components/ui'

export function NotFoundPage() {
  return (
    <div className="bg-surface h-full w-full">
      <StateView
        layout="page"
        icon={<AlertIcon />}
        title="Page not found"
        description="The screen you tried to open does not exist in this version of AssessX."
        action={
          <Link to={routes.root} className={buttonClasses('secondary')}>
            Go to start
          </Link>
        }
      />
    </div>
  )
}
