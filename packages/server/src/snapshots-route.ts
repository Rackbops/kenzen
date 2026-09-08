import type { DatabaseSync } from "node:sqlite"
import type { Context, Hono } from "hono"

/** design.md section 4.3: every response carries apiVersion: 1. */
export const API_VERSION = 1

/** `limit` on `GET /api/snapshots` is capped here -- and defaults to it when absent -- so an
 * unbounded query can never return the whole history table in one response (kenzen#16's own
 * "limit capped (say 100)" ask). */
const MAX_LIMIT = 100

const KINDS = new Set([
  "dockerfile-base",
  "compose-image",
  "github-action",
  "npm-dep",
  "pip-dep",
  "runtime-pin",
])
const ROLES = new Set(["runtime", "test", "build", "ci", "infra"])
const ADVISORY_STATUSES = new Set(["affected", "historical-only", "none", "unknown"])

function errorBody(error: string, path?: string): Record<string, unknown> {
  return path === undefined
    ? { apiVersion: API_VERSION, error }
    : { apiVersion: API_VERSION, error, path }
}

interface SnapshotRow {
  id: number
  generatedAt: string
  inventoryItems: number
  summary_json: string
}

interface ItemRow {
  key: string
  repo: string
  kind: string
  name: string
  pinned: string | null
  pinStyle: string | null
  role: string | null
  source: string | null
  latest: string | null
  latestInMajor: string | null
  gap: string | null
  advisoryStatus: string | null
  advisories_json: string | null
  assumed: string | null
  note: string | null
  d_skippedVersion: string | null
  d_remindAt: string | null
  d_approvedVersion: string | null
  d_acknowledged_json: string | null
  d_updatedAt: string | null
  d_updatedBy: string | null
}

/**
 * Shapes one joined row into a ReportItem (design.md section 4.1) plus its current decision.
 * `decision` is `null`, not an object of nulls, when the LEFT JOIN found no `decisions` row for
 * this key -- distinguished by `d_updatedAt`, the one decision column that is always NOT NULL
 * when a row exists (migrations/0001_init.sql). The `decisions` table is empty until K4-5 ships
 * (kenzen#16's own scope note), so every item's decision is null for now -- a correct reflection
 * of current state, not a placeholder.
 */
function toReportItem(row: ItemRow): Record<string, unknown> {
  const decision =
    row.d_updatedAt === null
      ? null
      : {
          skippedVersion: row.d_skippedVersion,
          remindAt: row.d_remindAt,
          approvedVersion: row.d_approvedVersion,
          acknowledgedAdvisories: row.d_acknowledged_json
            ? (JSON.parse(row.d_acknowledged_json) as unknown)
            : null,
          updatedAt: row.d_updatedAt,
          updatedBy: row.d_updatedBy,
        }
  return {
    key: row.key,
    repo: row.repo,
    kind: row.kind,
    name: row.name,
    pinned: row.pinned,
    pinStyle: row.pinStyle,
    role: row.role,
    source: row.source,
    latest: row.latest,
    latestInMajor: row.latestInMajor,
    gap: row.gap,
    advisoryStatus: row.advisoryStatus,
    advisories: row.advisories_json ? (JSON.parse(row.advisories_json) as unknown) : [],
    assumed: row.assumed,
    note: row.note,
    decision,
  }
}

/**
 * `GET /api/snapshots?limit=`, design.md section 4.3: newest snapshots first. A non-integer or
 * non-positive `limit` is a 422 naming the parameter (a caller bug worth surfacing); a `limit`
 * over `MAX_LIMIT`, or an absent one, is silently clamped to it -- a safety cap the caller
 * doesn't need to know about, unlike a nonsensical value.
 */
function mountSnapshotsListRoute(app: Hono, db: DatabaseSync): void {
  app.get("/api/snapshots", (c: Context) => {
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

    const rows = db
      .prepare(
        "SELECT id, generatedAt, inventoryItems, summary_json FROM snapshots ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as unknown as SnapshotRow[]

    const snapshots = rows.map((r) => ({
      snapshotId: r.id,
      generatedAt: r.generatedAt,
      inventoryItems: r.inventoryItems,
      summary: JSON.parse(r.summary_json) as unknown,
    }))

    return c.json({ apiVersion: API_VERSION, snapshots })
  })
}

/** `\d+` only -- a snapshot id is an autoincrement integer, so anything else can never match one. */
function parseSnapshotId(raw: string): number | null {
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : null
}

/**
 * `GET /api/snapshots/:id/items?repo=&kind=&role=&status=`, design.md section 4.3: the
 * ReportItems of one snapshot, joined with the current decision per key. An unknown or
 * malformed `:id` is a 404 (a snapshot id is a specific resource reference, unlike a free-form
 * filter value); an unrecognised `kind`/`role`/`status` is a 422 naming the parameter, checked
 * before any query runs. `repo` has no enum to check against (repo names are free-form) and an
 * empty-string filter value is treated as absent, matching `config.ts`'s `nonEmpty` convention.
 * All filter values are bound as SQL parameters -- never string-interpolated -- so there is no
 * injection surface regardless of what a caller passes.
 */
function mountSnapshotItemsRoute(app: Hono, db: DatabaseSync): void {
  app.get("/api/snapshots/:id/items", (c: Context) => {
    const idParam = c.req.param("id") ?? ""
    const snapshotId = parseSnapshotId(idParam)
    if (snapshotId === null) {
      return c.json(errorBody(`snapshot not found: ${idParam}`), 404)
    }
    const snapshot = db.prepare("SELECT id FROM snapshots WHERE id = ?").get(snapshotId)
    if (!snapshot) {
      return c.json(errorBody(`snapshot not found: ${snapshotId}`), 404)
    }

    const repo = nonEmpty(c.req.query("repo"))
    const kind = nonEmpty(c.req.query("kind"))
    const role = nonEmpty(c.req.query("role"))
    const status = nonEmpty(c.req.query("status"))

    if (kind !== undefined && !KINDS.has(kind)) {
      return c.json(errorBody(`unknown kind: ${kind}`, "kind"), 422)
    }
    if (role !== undefined && !ROLES.has(role)) {
      return c.json(errorBody(`unknown role: ${role}`, "role"), 422)
    }
    if (status !== undefined && !ADVISORY_STATUSES.has(status)) {
      return c.json(errorBody(`unknown status: ${status}`, "status"), 422)
    }

    const clauses = ["i.snapshotId = ?"]
    const params: (string | number)[] = [snapshotId]
    if (repo !== undefined) {
      clauses.push("i.repo = ?")
      params.push(repo)
    }
    if (kind !== undefined) {
      clauses.push("i.kind = ?")
      params.push(kind)
    }
    if (role !== undefined) {
      clauses.push("i.role = ?")
      params.push(role)
    }
    if (status !== undefined) {
      clauses.push("i.advisoryStatus = ?")
      params.push(status)
    }

    const rows = db
      .prepare(
        `SELECT i.key, i.repo, i.kind, i.name, i.pinned, i.pinStyle, i.role, i.source,
                i.latest, i.latestInMajor, i.gap, i.advisoryStatus, i.advisories_json,
                i.assumed, i.note,
                d.skippedVersion as d_skippedVersion, d.remindAt as d_remindAt,
                d.approvedVersion as d_approvedVersion, d.acknowledged_json as d_acknowledged_json,
                d.updatedAt as d_updatedAt, d.updatedBy as d_updatedBy
         FROM items i
         LEFT JOIN decisions d ON d.key = i.key
         WHERE ${clauses.join(" AND ")}
         ORDER BY i.key ASC`,
      )
      .all(...params) as unknown as ItemRow[]

    return c.json({ apiVersion: API_VERSION, snapshotId, items: rows.map(toReportItem) })
  })
}

/** Undefined for null/undefined/empty-string -- a blank filter value means "no filter", the same
 * convention `config.ts`'s `nonEmpty` uses for a blank env/config value. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== "" ? value : undefined
}

export function mountSnapshotsRoute(app: Hono, db: DatabaseSync): void {
  mountSnapshotsListRoute(app, db)
  mountSnapshotItemsRoute(app, db)
}
