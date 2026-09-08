import type { DatabaseSync } from "node:sqlite"
import type { Context, Hono } from "hono"
import { countByRepoKindName, findDecisionForItem, listDecisions } from "./decisions.js"
import type { SuppressionItem } from "./suppression.js"
import { effectiveAdvisoryStatus, suppressionState } from "./suppression.js"

/** design.md section 4.3: every response carries apiVersion: 1. */
export const API_VERSION = 1

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

function latestSnapshotId(db: DatabaseSync): number | null {
  const row = db.prepare("SELECT id FROM snapshots ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined
  return row?.id ?? null
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
 * `GET /api/repos` -> per repo: item counts by role, counts by gap and advisoryStatus, the
 * Dependabot read-back, and the soundness line (design.md sections 4.3, 6). All computed live
 * from the LATEST snapshot's items -- nothing is precomputed at ingest time, so this always
 * reflects the current data even before any UI/formatting layer exists.
 *
 * "D decided" (K4-5): an item counts as decided when `suppressionState`/
 * `effectiveAdvisoryStatus` (design.md section 5) removes it from what would otherwise be an
 * actionable gap or advisory count -- a "remind" verdict does NOT count as decided (design.md:
 * a due reminder surfaces again, it doesn't quietly resolve), and an item decided on BOTH axes
 * (a suppressed gap and an acknowledged advisory) still counts once, not twice.
 *
 * The decision per item is resolved via `findDecisionForItem` (K4-5b), not a plain key lookup:
 * an item whose `source` line moved since it was decided (a file edit bumped its line number,
 * so its `key` changed) is re-matched by `repo|kind|name` rather than silently losing its
 * decision -- design.md section 5.
 */
export function mountReposRoute(app: Hono, db: DatabaseSync): void {
  app.get("/api/repos", (c: Context) => {
    const snapshotId = latestSnapshotId(db)
    if (snapshotId === null) {
      return c.json({ apiVersion: API_VERSION, repos: [] })
    }

    const itemRepoRows = db
      .prepare("SELECT DISTINCT repo FROM items WHERE snapshotId = ?")
      .all(snapshotId) as { repo: string }[]
    const dependabotRepoRows = db
      .prepare("SELECT DISTINCT repo FROM repos WHERE snapshotId = ?")
      .all(snapshotId) as { repo: string }[]
    const repoNames = Array.from(
      new Set([...itemRepoRows.map((r) => r.repo), ...dependabotRepoRows.map((r) => r.repo)]),
    ).sort()

    const totalRows = db
      .prepare("SELECT repo, COUNT(*) as c FROM items WHERE snapshotId = ? GROUP BY repo")
      .all(snapshotId) as { repo: string; c: number }[]
    const totals = new Map(totalRows.map((r) => [r.repo, r.c]))

    const itemRows = db
      .prepare(
        `SELECT key, repo, kind, name, role, pinned, latest, gap, advisoryStatus, advisories_json
         FROM items WHERE snapshotId = ?`,
      )
      .all(snapshotId) as unknown as ItemRow[]

    const dependabotRows = db
      .prepare("SELECT repo, dependabot_json FROM repos WHERE snapshotId = ?")
      .all(snapshotId) as { repo: string; dependabot_json: string }[]
    const dependabot = new Map(
      dependabotRows.map((r) => [r.repo, JSON.parse(r.dependabot_json) as unknown]),
    )

    const decisions = listDecisions(db)
    const occurrenceCounts = countByRepoKindName(itemRows)
    const now = new Date().toISOString()

    const byRepo = new Map<string, RepoSummary>()
    for (const repo of repoNames) {
      byRepo.set(repo, {
        repo,
        role: {},
        gap: {},
        advisoryStatus: {},
        dependabotAlerts: dependabot.get(repo) ?? "not enabled",
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

    const repos = repoNames.map((repo) => {
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

    return c.json({ apiVersion: API_VERSION, repos })
  })
}
