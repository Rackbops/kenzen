import type { DatabaseSync } from "node:sqlite"
import type { Soundness } from "@kenzen/contract/soundness"
import type { SuppressionItem } from "@kenzen/contract/suppression"
import { effectiveAdvisoryStatus, suppressionState } from "@kenzen/contract/suppression"
import { countByRepoKindName, findDecisionForItem, listDecisions } from "./decisions.js"

export interface RepoSummary {
  repo: string
  role: Record<string, number>
  gap: Record<string, number>
  advisoryStatus: Record<string, number>
  dependabotAlerts: unknown
  /** Items removed from `gap`/`advisoryStatus`'s actionable counts by a suppressing decision
   * (K4-5) -- the same number the soundness line's "D decided" reads. */
  decided: number
  soundness: string
}

interface ItemRow {
  key: string
  repo: string
  kind: string
  name: string
  role: string | null
  pinned: string | null
  latest: string | null
  gap: string | null
  advisoryStatus: string | null
  advisories_json: string | null
}

/**
 * Per-repo item counts by role, gap, and advisoryStatus, the Dependabot read-back, and the
 * formatted soundness line, for ONE specific snapshot (design.md sections 4.3, 6) -- every
 * tracked repo, or just `repo` when given (see the parameter's own comment below for why).
 * Extracted from `GET /api/repos` (K4-8b) so kenzen#38's per-snapshot soundness (the
 * `/api/snapshots` estate field, and the `/api/repos/:repo/soundness` series) can reuse the
 * exact same decision-suppression-aware arithmetic instead of a second implementation that
 * could drift from it -- `GET /api/repos` still calls this with `repo` omitted and the latest
 * snapshot id, unchanged from before the extraction.
 *
 * Decision suppression is always evaluated against the CURRENT set of decisions, never ones
 * frozen at the named snapshot's own ingest time -- matching `GET /api/repos`'s existing
 * behavior for the latest snapshot (its own docstring: "nothing is precomputed at ingest time,
 * so this always reflects the current data"). kenzen#38 extends this same choice to every
 * snapshot in a series rather than freezing history at ingest, deliberately: a decision made
 * today should read consistently across the whole trend line, not just from the next ingest
 * onward, and it needs no backfill migration for snapshots ingested before this shipped.
 *
 * "D decided" (K4-5): an item counts as decided when `suppressionState`/`effectiveAdvisoryStatus`
 * (design.md section 5) removes it from what would otherwise be an actionable gap or advisory
 * count -- a "remind" verdict does NOT count as decided (design.md: a due reminder surfaces
 * again, it doesn't quietly resolve), and an item decided on BOTH axes (a suppressed gap and an
 * acknowledged advisory) still counts once, not twice.
 *
 * The decision per item is resolved via `findDecisionForItem` (K4-5b), not a plain key lookup:
 * an item whose `source` line moved since it was decided (a file edit bumped its line number,
 * so its `key` changed) is re-matched by `repo|kind|name` rather than silently losing its
 * decision -- design.md section 5.
 */
export function computeRepoSummaries(
  db: DatabaseSync,
  snapshotId: number,
  repo?: string,
): RepoSummary[] {
  // `repo`, when given, scopes every query below to just that one repo -- kenzen#38 review
  // round 1, HIGH: `GET /api/repos/:repo/soundness` originally called this UNSCOPED once per
  // snapshot in its window and threw away every repo's result but one, an N+1-within-N+1 cost
  // that scales with O(repos x items) instead of O(items in the one requested repo). At this
  // deployment's actual current scale (765 items across ~19 repos, `History.tsx`'s real
  // `SERIES_LIMIT` of 30 snapshots), the unscoped pattern measured ~105ms and the scoped one
  // ~15ms -- not an availability crisis today, but the ratio between them widens as either
  // tracked-repo count or snapshot history grows, and the scoped query is free to write either
  // way. (Round 2 review, MEDIUM: an earlier version of this comment cited a ~2.3s figure from
  // a benchmark at 800 items PER REPO, ~20x this app's real ~40 items/repo -- corrected here to
  // the deployment's own measured numbers rather than an extrapolated worst case.)
  // `/api/repos` (the all-repos listing) still calls this with `repo` omitted, unchanged from
  // before.
  //
  // Scoping the item query to one repo cannot change `countByRepoKindName`'s ambiguity counts
  // for that repo's own items: `repo` is part of the `repo|kind|name` key it disambiguates on,
  // so two items from DIFFERENT repos could never collide there regardless of whether other
  // repos' rows are present in the input.
  const repoFilter = repo === undefined ? "" : " AND repo = ?"
  const repoParams = repo === undefined ? [] : [repo]

  const itemRepoRows = db
    .prepare(`SELECT DISTINCT repo FROM items WHERE snapshotId = ?${repoFilter}`)
    .all(snapshotId, ...repoParams) as { repo: string }[]
  const dependabotRepoRows = db
    .prepare(`SELECT DISTINCT repo FROM repos WHERE snapshotId = ?${repoFilter}`)
    .all(snapshotId, ...repoParams) as { repo: string }[]
  const repoNames = Array.from(
    new Set([...itemRepoRows.map((r) => r.repo), ...dependabotRepoRows.map((r) => r.repo)]),
  ).sort()

  const totalRows = db
    .prepare(
      `SELECT repo, COUNT(*) as c FROM items WHERE snapshotId = ?${repoFilter} GROUP BY repo`,
    )
    .all(snapshotId, ...repoParams) as { repo: string; c: number }[]
  const totals = new Map(totalRows.map((r) => [r.repo, r.c]))

  const itemRows = db
    .prepare(
      `SELECT key, repo, kind, name, role, pinned, latest, gap, advisoryStatus, advisories_json
       FROM items WHERE snapshotId = ?${repoFilter}`,
    )
    .all(snapshotId, ...repoParams) as unknown as ItemRow[]

  const dependabotRows = db
    .prepare(`SELECT repo, dependabot_json FROM repos WHERE snapshotId = ?${repoFilter}`)
    .all(snapshotId, ...repoParams) as { repo: string; dependabot_json: string }[]
  const dependabot = new Map(
    dependabotRows.map((r) => [r.repo, JSON.parse(r.dependabot_json) as unknown]),
  )

  const decisions = listDecisions(db)
  const occurrenceCounts = countByRepoKindName(itemRows)
  const now = new Date().toISOString()

  const byRepo = new Map<string, RepoSummary>()
  for (const repoName of repoNames) {
    byRepo.set(repoName, {
      repo: repoName,
      role: {},
      gap: {},
      advisoryStatus: {},
      dependabotAlerts: dependabot.get(repoName) ?? "not enabled",
      soundness: "",
      decided: 0,
    })
  }

  for (const row of itemRows) {
    const entry = byRepo.get(row.repo)
    if (!entry) {
      continue
    }
    if (row.role !== null) {
      entry.role[row.role] = (entry.role[row.role] ?? 0) + 1
    }

    const decision = findDecisionForItem(decisions, row, occurrenceCounts)
    const item: SuppressionItem = {
      pinned: row.pinned,
      latest: row.latest,
      advisoryStatus: row.advisoryStatus,
      advisories: row.advisories_json
        ? (JSON.parse(row.advisories_json) as { id: string; affected: boolean }[])
        : [],
    }

    let decidedThisItem = false

    // "none"/"unknown" were never actionable in the first place -- a decision can't suppress
    // its way out of a gap that doesn't exist, so only major/minor/patch consult the verdict.
    if (row.gap !== null) {
      const actionable = row.gap === "major" || row.gap === "minor" || row.gap === "patch"
      const suppressed = actionable && suppressionState(item, decision, now) === "suppressed"
      if (suppressed) {
        decidedThisItem = true
      } else {
        entry.gap[row.gap] = (entry.gap[row.gap] ?? 0) + 1
      }
    }

    if (row.advisoryStatus !== null) {
      const effective = effectiveAdvisoryStatus(item, decision)
      if (row.advisoryStatus === "affected" && effective !== "affected") {
        decidedThisItem = true
      } else if (effective !== null) {
        entry.advisoryStatus[effective] = (entry.advisoryStatus[effective] ?? 0) + 1
      }
    }

    if (decidedThisItem) {
      entry.decided += 1
    }
  }

  return repoNames.map((repo) => {
    const entry = byRepo.get(repo)
    // Safe: byRepo was built from the exact same repoNames array above.
    if (!entry) {
      throw new Error(`unreachable: no entry for ${repo}`)
    }
    const total = totals.get(repo) ?? 0
    const affected = entry.advisoryStatus.affected ?? 0
    const major = entry.gap.major ?? 0
    const minor = entry.gap.minor ?? 0
    const patch = entry.gap.patch ?? 0
    const unknown = entry.gap.unknown ?? 0
    const behind = major + minor + patch
    entry.soundness =
      `${total} items · ${affected} affected · ${behind} behind ` +
      `(${major}/${minor}/${patch}) · ${entry.decided} decided · ${unknown} unknown`
    return entry
  })
}

/**
 * Sums `computeRepoSummaries`' per-repo counts into one `Soundness` object -- the server-side
 * mirror of `packages/web/src/routes/History.tsx`'s `estateSoundness`, kept as the EXACT same
 * arithmetic (sum `role`'s values for item count, `advisoryStatus.affected`,
 * `gap.major`/`gap.minor`/`gap.patch`/`gap.unknown`, `decided`) so the two can never disagree
 * (kenzen#38 acceptance: the server's latest-snapshot number must equal the client's). A single
 * repo's own `Soundness` is this same function called with a one-element array -- no separate
 * per-repo aggregator needed.
 *
 * Returns the typed object, not `computeRepoSummaries`' own formatted `soundness` string --
 * a caller that wants the string re-derives it the same way that field already does.
 */
export function aggregateSoundness(repos: RepoSummary[]): Soundness {
  let items = 0
  let affected = 0
  let major = 0
  let minor = 0
  let patch = 0
  let unknown = 0
  let decided = 0
  for (const r of repos) {
    for (const n of Object.values(r.role)) {
      items += n
    }
    affected += r.advisoryStatus.affected ?? 0
    major += r.gap.major ?? 0
    minor += r.gap.minor ?? 0
    patch += r.gap.patch ?? 0
    unknown += r.gap.unknown ?? 0
    decided += r.decided
  }
  return { items, affected, behind: { major, minor, patch }, decided, unknown }
}
