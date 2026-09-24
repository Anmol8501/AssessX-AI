/** Formatting shared by the candidate's exam screens. */

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

/** The availability window as a sentence, or a plain statement that there isn't one. */
export function formatWindow(start: string | null, end: string | null): string {
  if (start && end) return `${formatDate(start)} — ${formatDate(end)}`
  if (start) return `From ${formatDate(start)}`
  if (end) return `Until ${formatDate(end)}`
  return 'No scheduled window'
}
