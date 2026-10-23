export function formatDuration(seconds: number): string {
  if (seconds < 0) return '00:00'

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds,
  ).padStart(2, '0')}`

}