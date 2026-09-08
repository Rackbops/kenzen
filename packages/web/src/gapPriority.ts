/**
 * Severity ordering for a ReportItem's `gap`, most urgent first. Shared so NeedsDecision's
 * affected-then-by-severity priority and Repos.tsx's Gap column sort agree on what "worse"
 * means, rather than each inventing its own ordering (K4-8a review round 1, LOW: Repos.tsx's
 * Gap column originally sorted the raw string lexicographically, putting "none" between
 * "minor" and "patch").
 *
 * `unknown` ranks ahead of `none` (round 2, LOW), not behind it: Tooling's own
 * `software_report.py` documents this as a deliberate, tested choice (its `render_markdown`,
 * "Tooling#425 PR B review round 4") -- a floating pin that never resolved a comparable
 * version "counts as interesting... the same as a confirmed real gap... not buried among
 * routine, fully-verified-clean items." Kenzen's own severity order should agree with the
 * precedent it's presenting the same data alongside.
 */
const ORDER: Record<string, number> = { major: 0, minor: 1, patch: 2, unknown: 3, none: 4 }

export function gapPriority(gap: string | null): number {
  if (gap === null) {
    return ORDER.unknown as number
  }
  return ORDER[gap] ?? (ORDER.unknown as number)
}
