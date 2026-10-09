import { Button } from './Button'

/** "Load more" under a paged list (CX-04). Hidden when the server says there is nothing more. */
export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null
  return (
    <div className="flex justify-center py-3">
      <Button variant="secondary" size="sm" loading={loading} onClick={onClick}>
        Load more
      </Button>
    </div>
  )
}
