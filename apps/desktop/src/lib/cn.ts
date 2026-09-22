/** Joins class names, dropping falsy entries. Small enough that a dependency is not justified. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}
