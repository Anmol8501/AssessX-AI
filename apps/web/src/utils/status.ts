export function getResultStatus(percentage: number): 'passed' | 'failed' {
  return percentage >= 40 ? 'passed' : 'failed'
}


