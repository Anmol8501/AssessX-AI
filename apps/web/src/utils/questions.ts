export function getQuestionProgress(
  answered: number,
  total: number,
): number {
  if (total <= 0) return 0

  return Math.min(100, Math.round((answered / total) * 100))
}


export function getQuestionProgress(
  answered: number,
  total: number,
): number {
  if (total <= 0) return 0

  return Math.min(100, Math.round((answered / total) * 100))
}