/** Builder step identity and the mapping from a readiness issue to the step that can fix it. */

export const BUILDER_STEPS = ['basics', 'questions', 'settings', 'review', 'assign'] as const
export type BuilderStep = (typeof BUILDER_STEPS)[number]

export const STEP_LABEL: Record<BuilderStep, string> = {
  basics: 'Basic information',
  questions: 'Questions',
  settings: 'Settings',
  review: 'Review',
  assign: 'Assign',
}

const SETTINGS_FIELDS = new Set(['max_attempts', 'availability_start', 'availability_end', 'question_navigation'])

/** Maps a readiness issue's `field` (e.g. `title`, `questions.<id>`) to its builder step. */
export function stepForField(field: string): BuilderStep {
  if (field.startsWith('questions')) return 'questions'
  if (SETTINGS_FIELDS.has(field)) return 'settings'
  return 'basics'
}
