import type { DatabaseSync } from "node:sqlite"
import type { Context, Hono } from "hono"

/** design.md section 4.3: every response carries apiVersion: 1. */
export const API_VERSION = 1

interface HistoryRow {
  snapshotId: number
  generatedAt: string
  pinned: string | null
  latest: string | null
  gap: string | null
  advisoryStatus: string | null
}

/**
 * `GET /api/items/:key/history`, design.md section 4.3: one item's `pinned`/`latest`/`gap`/
 * `advisoryStatus` across every snapshot it appears in, oldest first by the owning snapshot's
 * `generatedAt` (append-only ingest means this matches insertion order in practice, but ordering
 * by the semantic timestamp rather than the autoincrement id is the correct contract regardless
 * of insertion order). Uses `idx_items_key` (K4-3, migrations/0001_init.sql) via `WHERE i.key = ?`.
 *
 * `:key` is `repo|kind|name|source` (design.md sections 4.1-4.2), and `repo`/`source` routinely
 * contain `/` (e.g. `Rackbops/rackbops-discord-bot`, `docker/Dockerfile:12`) while the key
 * itself always contains `|`. Hono decodes a path-param segment with `decodeURIComponent`
 * before handing it to `c.req.param`, so the CALLER must build the URL with
 * `encodeURIComponent(key)` (which escapes both `/` -> `%2F` and `|` -> `%7C` into a single path
 * segment) rather than interpolating the raw key. An un-encoded `/` in the key would split into
 * extra path segments and never match this route at all -- it would fall through to the SPA
 * catch-all (`app.ts`'s trailing `app.get("*", ...)`) instead of hitting this handler or 404ing.
 * The round-trip through a realistic key containing both `/` and `|` is proven by
 * `item-history-route.test.ts`.
 *
 * An unknown key returns an empty history with a 200, not a 404 -- the same choice `GET
 * /api/repos` makes returning `{repos: []}` before any ingest (`repos-route.ts`): a key is a
 * free-form identifier, not a resource whose absence is itself an error the way a numeric
 * snapshot id's is (`snapshots-route.ts`'s `GET /api/snapshots/:id/items`).
 */
export function mountItemHistoryRoute(app: Hono, db: DatabaseSync): void {
  app.get("/api/items/:key/history", (c: Context) => {
    const key = c.req.param("key") ?? ""

    const rows = db
      .prepare(
        `SELECT s.id as snapshotId, s.generatedAt as generatedAt,
                i.pinned, i.latest, i.gap, i.advisoryStatus
         FROM items i
         JOIN snapshots s ON s.id = i.snapshotId
         WHERE i.key = ?
         ORDER BY s.generatedAt ASC`,
      )
      .all(key) as unknown as HistoryRow[]

    const history = rows.map((r) => ({
      snapshotId: r.snapshotId,
      generatedAt: r.generatedAt,
      pinned: r.pinned,
      latest: r.latest,
      gap: r.gap,
      advisoryStatus: r.advisoryStatus,
    }))

    return c.json({ apiVersion: API_VERSION, key, history })
  })
}
