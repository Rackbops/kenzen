import type { DatabaseSync } from "node:sqlite"
import type { Context, Hono } from "hono"

/** design.md section 4.3: every response carries apiVersion: 1. */
export const API_VERSION = 1

export interface RepoSummary {
  repo: string
  role: Record<string, number>
  gap: Record<string, number>
  advisoryStatus: Record<string, number>
  dependabotAlerts: unknown
  soundness: string
}

function latestSnapshotId(db: DatabaseSync): number | null {
  const row = db.prepare("SELECT id FROM snapshots ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined
  return row?.id ?? null
}

/**
 * `GET /api/repos` -> per repo: item counts by role, counts by gap and advisoryStatus, the
 * Dependabot read-back, and the soundness line (design.md sections 4.3, 6). All computed live
 * from the LATEST snapshot's items -- nothing is precomputed at ingest time, so this always
 * reflects the current data even before any UI/formatting layer exists.
 *
 * The soundness line's "D decided" is always 0 here: the decisions API (K4-5) doesn't exist
 * yet, so nothing has ever been decided against any ingested item. This is a correct reflection
 * of current state, not a placeholder to fix later in this same module -- it becomes real once
 * K4-5 ships and starts writing to the `decisions` table.
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

    const roleRows = db
      .prepare(
        "SELECT repo, role, COUNT(*) as c FROM items WHERE snapshotId = ? GROUP BY repo, role",
      )
      .all(snapshotId) as { repo: string; role: string | null; c: number }[]
    const gapRows = db
      .prepare("SELECT repo, gap, COUNT(*) as c FROM items WHERE snapshotId = ? GROUP BY repo, gap")
      .all(snapshotId) as { repo: string; gap: string | null; c: number }[]
    const statusRows = db
      .prepare(
        "SELECT repo, advisoryStatus, COUNT(*) as c FROM items WHERE snapshotId = ? GROUP BY repo, advisoryStatus",
      )
      .all(snapshotId) as { repo: string; advisoryStatus: string | null; c: number }[]

    const dependabotRows = db
      .prepare("SELECT repo, dependabot_json FROM repos WHERE snapshotId = ?")
      .all(snapshotId) as { repo: string; dependabot_json: string }[]
    const dependabot = new Map(
      dependabotRows.map((r) => [r.repo, JSON.parse(r.dependabot_json) as unknown]),
    )

    const byRepo = new Map<string, RepoSummary>()
    for (const repo of repoNames) {
      byRepo.set(repo, {
        repo,
        role: {},
        gap: {},
        advisoryStatus: {},
        dependabotAlerts: dependabot.get(repo) ?? "not enabled",
        soundness: "",
      })
    }
    for (const row of roleRows) {
      if (row.role !== null) {
        const entry = byRepo.get(row.repo)
        if (entry) {
          entry.role[row.role] = row.c
        }
      }
    }
    for (const row of gapRows) {
      if (row.gap !== null) {
        const entry = byRepo.get(row.repo)
        if (entry) {
          entry.gap[row.gap] = row.c
        }
      }
    }
    for (const row of statusRows) {
      if (row.advisoryStatus !== null) {
        const entry = byRepo.get(row.repo)
        if (entry) {
          entry.advisoryStatus[row.advisoryStatus] = row.c
        }
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
        `(${major}/${minor}/${patch}) · 0 decided · ${unknown} unknown`
      return entry
    })

    return c.json({ apiVersion: API_VERSION, repos })
  })
}
