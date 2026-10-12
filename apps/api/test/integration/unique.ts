/** Stable-enough uniqueness across Vitest file collection in the same ms. */
export function uniqueSuffix(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
