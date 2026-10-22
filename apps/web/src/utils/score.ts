export function calculatePercentage(
  score: number,
  total: number,
): number {
  if (total <= 0) return 0

  const percentage = (score / total) * 100
  return Math.round(percentage * 100) / 100
}






export function calculatePercentage(
  score: number,
  total: number,
): number {
  if (total <= 0) return 0

  const percentage = (score / total) * 100
  return Math.round(percentage * 100) / 100
}