import { effectiveAdvisoryStatus, suppressionState } from "@kenzen/contract/suppression"
import type { ReportItem } from "./api.js"
import { gapPriority } from "./gapPriority.js"

/**
 * Shared between NeedsDecision.tsx (which section-1-filters on this) and Repos.tsx (which
 * uses it only to decide whether to show DecisionActions on a row at all -- section 2 still
 * shows every item, decided or not, per design.md, but there's nothing to action on a
 * fully-sound or already-suppressed one). design.md section 5's decision-effect table via
 * `@kenzen/contract/suppression` (K4-9) -- not just "is there any decision row at all"
 * (K4-8a's superseded placeholder gate): a stale skip whose target has since moved, or a
 * remind whose date has passed, still needs a decision again.
 */
export function needsDecision(item: ReportItem, now: string): boolean {
  if (effectiveAdvisoryStatus(item, item.decision) === "affected") return true
  if (item.gap !== "major" && item.gap !== "minor" && item.gap !== "patch") return false
  return suppressionState(item, item.decision, now) !== "suppressed"
}

/** Affected trumps any gap severity (design.md: "advisoryStatus = affected ... first, then
 * gap"); among the rest, `gapPriority` orders it. -1 is enough separation since gapPriority's
 * own range starts at 0. Meaningful only on a row that already passed needsDecision. */
export function decisionPriority(item: ReportItem): number {
  if (effectiveAdvisoryStatus(item, item.decision) === "affected") return -1
  return gapPriority(item.gap)
}
