/**
 * Severity ordering for a ReportItem's `gap`, most urgent first. Shared so NeedsDecision's
 * affected-then-by-severity priority and Repos.tsx's Gap column sort agree on what "worse"
 * means, rather than each inventing its own ordering (K4-8a review round 1, LOW: Repos.tsx's
 * Gap column originally sorted the raw string lexicographically, putting "none" between
 * "minor" and "patch").
 */
const ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2, none: 3, unknown: 4 }

export function gapPriority(gap: string | null): number {
  if (gap === null) {
    return ORDER.unknown as number
  }
  return ORDER[gap] ?? (ORDER.unknown as number)
}
