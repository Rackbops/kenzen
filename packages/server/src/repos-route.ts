import type { DatabaseSync } from "node:sqlite"
import type { Context, Hono } from "hono"
import { MAX_LIMIT } from "./snapshots-route.js"
import { aggregateSoundness, computeRepoSummaries } from "./soundness.js"

/** design.md section 4.3: every response carries apiVersion: 1. */
export const API_VERSION = 1

export type { RepoSummary } from "./soundness.js"

function latestSnapshotId(db: DatabaseSync): number | null {
  const row = db.prepare("SELECT id FROM snapshots ORDER BY id DESC LIMIT 1").get() as
    | { id: number }
    | undefined
  return row?.id ?? null
}

function errorBody(error: string, path?: string): Record<string, unknown> {
  return path === undefined
    ? { apiVersion: API_VERSION, error }
    : { apiVersion: API_VERSION, error, path }
}

/**
 * `GET /api/repos` -> per repo: item counts by role, counts by gap and advisoryStatus, the
 * Dependabot read-back, and the soundness line (design.md sections 4.3, 6), for the LATEST
 * snapshot. The actual per-repo computation is `./soundness.js`'s `computeRepoSummaries`
 * (extracted in kenzen#38 so the per-snapshot soundness series can reuse it) -- this route only
 * resolves "latest" and shapes the HTTP response.
 */
function mountReposListRoute(app: Hono, db: DatabaseSync): void {
  app.get("/api/repos", (c: Context) => {
    const snapshotId = latestSnapshotId(db)
    if (snapshotId === null) {
      return c.json({ apiVersion: API_VERSION, repos: [] })
    }
    const repos = computeRepoSummaries(db, snapshotId)
    return c.json({ apiVersion: API_VERSION, repos })
  })
}

/**
 * `GET /api/repos/:repo/soundness?limit=`, design.md section 6's "soundness line over time"
 * (kenzen#38): one repo's `Soundness` across its most recent snapshots, oldest first (a
 * series/trend reads left-to-right chronologically, the opposite of `/api/snapshots`' own
 * newest-first order). `limit` shares `/api/snapshots`' exact cap and validation (`MAX_LIMIT`,
 * imported from there) rather than a second policy that could drift from it.
 *
 * `:repo` is a repo name (`Owner/name`), which contains `/` -- the same situation
 * `item-history-route.ts`'s `:key` already handles: Hono decodes a path-param segment with
 * `decodeURIComponent` before handing it to `c.req.param`, so the CALLER must build the URL
 * with `encodeURIComponent(repo)` rather than interpolating the raw name (see
 * `packages/web/src/api.ts`'s `fetchRepoSoundnessSeries`, which does).
 *
 * A repo absent from a given snapshot (never ingested yet as of that point, or ingested only
 * under a different name since) is skipped for that point rather than reported as an all-zero
 * `Soundness` -- a zeroed point would misleadingly read as "perfectly sound then", when really
 * the repo just was not tracked yet. An UNKNOWN repo name (never ingested at all) therefore
 * returns a 200 with an empty `series`, matching `item-history-route.ts`'s own choice for an
 * unknown `:key`: a repo name is a free-form identifier, not a resource whose absence is itself
 * an error.
 */
function mountRepoSoundnessSeriesRoute(app: Hono, db: DatabaseSync): void {
  app.get("/api/repos/:repo/soundness", (c: Context) => {
    const repo = c.req.param("repo") ?? ""

    const limitParam = c.req.query("limit")
    let limit = MAX_LIMIT
    if (limitParam !== undefined && limitParam !== "") {
      if (!/^[1-9][0-9]*$/.test(limitParam)) {
        return c.json(
          errorBody(`limit must be a positive integer, got: ${limitParam}`, "limit"),
          422,
        )
      }
      limit = Math.min(Number(limitParam), MAX_LIMIT)
    }

    const snapshotRows = db
      .prepare("SELECT id, generatedAt FROM snapshots ORDER BY id DESC LIMIT ?")
      .all(limit) as { id: number; generatedAt: string }[]

    const series: {
      snapshotId: number
      generatedAt: string
      soundness: ReturnType<typeof aggregateSoundness>
    }[] = []
    for (const row of snapshotRows) {
      // Scoped to just `repo` (kenzen#38 review round 1, HIGH): computing every tracked repo's
      // summary per snapshot just to keep one was measured at ~2.3s for a realistic history
      // window -- see computeRepoSummaries' own docstring/comment for the benchmark. `.find`
      // rather than `[0]`: the scoped query can only ever return that one repo (or none), but
      // matching by name stays correct and self-explanatory even if that guarantee ever loosens.
      const entry = computeRepoSummaries(db, row.id, repo).find((r) => r.repo === repo)
      if (entry) {
        series.push({
          snapshotId: row.id,
          generatedAt: row.generatedAt,
          soundness: aggregateSoundness([entry]),
        })
      }
    }
    series.reverse()

    return c.json({ apiVersion: API_VERSION, repo, series })
  })
}

export function mountReposRoute(app: Hono, db: DatabaseSync): void {
  mountReposListRoute(app, db)
  mountRepoSoundnessSeriesRoute(app, db)
}
