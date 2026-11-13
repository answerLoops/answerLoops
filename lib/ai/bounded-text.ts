// The caps below exist for storage. Models don't reliably stay under them, and
// a schema max() turns a wordy answer into a failed call. So the schemas take
// any length and we trim here instead.
export const REASONING_MAX_CHARS = 400
export const SUMMARY_MAX_CHARS = 200

export function boundText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trimEnd()}…`
}
