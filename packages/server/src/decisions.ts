import type { DatabaseSync } from "node:sqlite"
import { parseVersion } from "./suppression.js"

/**
 * The decisions API's DB read/write logic, design.md sections 4.3 and 5. Split the same way
 * `ingest.ts`/`ingest-route.ts` are: this module owns validation and the one-transaction
 * write (plus the `decision_history` append); `decisions-route.ts` owns HTTP concerns
 * (parsing the PUT body, resolving the caller's identity).
 */

export interface DecisionRow {
  key: string
  repo: string
  kind: string | null
  name: string
  source: string | null
  skippedVersion: string | null
  remindAt: string | null
  approvedVersion: string | null
  acknowledgedAdvisories: string[] | null
  updatedAt: string
  updatedBy: string | null
}

export interface CurrentItem {
  repo: string
  kind: string
  name: string
  source: string
  pinned: string | null
  latest: string | null
  advisories: { id: string; affected: boolean }[]
}

export type DecisionPatch =
  | { field: "skippedVersion"; value: string }
  | { field: "remindAt"; value: string }
  | { field: "approvedVersion"; value: string }
  | { field: "acknowledgedAdvisories"; value: string[] }
  | { field: "clear" }

export type PutDecisionResult =
  | { ok: true; decision: DecisionRow | null }
  | { ok: false; status: 422; error: string }

interface RawDecisionRow {
  key: string
  repo: string
  kind: string | null
  name: string
  source: string | null
  skippedVersion: string | null
  remindAt: string | null
  approvedVersion: string | null
  acknowledged_json: string | null
  updatedAt: string
  updatedBy: string | null
}

function rowToDecision(row: RawDecisionRow): DecisionRow {
  return {
    key: row.key,
    repo: row.repo,
    kind: row.kind,
    name: row.name,
    source: row.source,
    skippedVersion: row.skippedVersion,
    remindAt: row.remindAt,
    approvedVersion: row.approvedVersion,
    acknowledgedAdvisories: row.acknowledged_json
      ? (JSON.parse(row.acknowledged_json) as string[])
      : null,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

export function listDecisions(db: DatabaseSync): DecisionRow[] {
  const rows = db
    .prepare("SELECT * FROM decisions ORDER BY key")
    .all() as unknown as RawDecisionRow[]
  return rows.map(rowToDecision)
}

function latestItemByKey(db: DatabaseSync, key: string): CurrentItem | null {
  const row = db
    .prepare(
      `SELECT repo, kind, name, source, pinned, latest, advisories_json FROM items
       WHERE key = ? AND snapshotId = (SELECT id FROM snapshots ORDER BY id DESC LIMIT 1)`,
    )
    .get(key) as
    | {
        repo: string
        kind: string
        name: string
        source: string
        pinned: string | null
        latest: string | null
        advisories_json: string | null
      }
    | undefined
  if (!row) {
    return null
  }
  return {
    repo: row.repo,
    kind: row.kind,
    name: row.name,
    source: row.source,
    pinned: row.pinned,
    latest: row.latest,
    advisories: row.advisories_json
      ? (JSON.parse(row.advisories_json) as { id: string; affected: boolean }[])
      : [],
  }
}

/**
 * `repo|kind|name|source`, matching `ingest.ts`'s own `itemKey` -- the fallback identity
 * source for a decision on a key that has never been ingested yet (design.md section 4.2
 * explicitly allows this: "a decision can be recorded before an item's first ingest").
 */
function parseKeyFallback(
  key: string,
): { repo: string; kind: string; name: string; source: string } | null {
  const parts = key.split("|")
  if (parts.length !== 4 || parts.some((p) => p === "")) {
    return null
  }
  const [repo, kind, name, source] = parts as [string, string, string, string]
  return { repo, kind, name, source }
}

/** "ISO-8601 UTC" per plan.md K4-5 -- the `Z` (Zulu) form specifically, matching every `now`
 * this app produces via `Date.prototype.toISOString()`; a numeric UTC offset (`+00:00`) is
 * intentionally not accepted. */
function isIsoUtcInFuture(value: string, now: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return false
  }
  const parsed = Date.parse(value)
  return !Number.isNaN(parsed) && parsed > Date.parse(now)
}

export function putDecision(
  db: DatabaseSync,
  key: string,
  patch: DecisionPatch,
  updatedBy: string,
  now: string,
): PutDecisionResult {
  const item = latestItemByKey(db, key)

  if (patch.field === "remindAt" && !isIsoUtcInFuture(patch.value, now)) {
    return {
      ok: false,
      status: 422,
      error: "remindAt must be an ISO-8601 UTC timestamp in the future",
    }
  }
  if (
    (patch.field === "skippedVersion" || patch.field === "approvedVersion") &&
    parseVersion(patch.value) === null
  ) {
    return {
      ok: false,
      status: 422,
      error: `${patch.field} is not a recognizable version string: ${patch.value}`,
    }
  }
  if (patch.field === "acknowledgedAdvisories") {
    const knownIds = new Set((item?.advisories ?? []).map((a) => a.id))
    const unknown = patch.value.filter((id) => !knownIds.has(id))
    if (unknown.length > 0) {
      return {
        ok: false,
        status: 422,
        error: `advisory id(s) not found on this item: ${unknown.join(", ")}`,
      }
    }
  }

  const existingRaw = db.prepare("SELECT * FROM decisions WHERE key = ?").get(key) as
    | RawDecisionRow
    | undefined
  const existing = existingRaw ? rowToDecision(existingRaw) : null

  if (patch.field === "clear") {
    if (!existing) {
      return { ok: true, decision: null }
    }
    db.exec("BEGIN")
    try {
      db.prepare("DELETE FROM decisions WHERE key = ?").run(key)
      db.prepare(
        "INSERT INTO decision_history (key, before_json, after_json, at, by) VALUES (?, ?, ?, ?, ?)",
      ).run(key, JSON.stringify(existing), JSON.stringify(null), now, updatedBy)
      db.exec("COMMIT")
    } catch (err) {
      db.exec("ROLLBACK")
      throw err
    }
    return { ok: true, decision: null }
  }

  const identity = item ?? parseKeyFallback(key)
  if (!identity) {
    return {
      ok: false,
      status: 422,
      error: `key is not a recognized repo|kind|name|source shape and no item exists for it: ${key}`,
    }
  }

  // Setting any one of the three version/time fields resets the other two -- design.md
  // section 5: "a new target resets either." `acknowledgedAdvisories` is a separate axis
  // (per-advisory, not whole-item) and is left untouched by a trio write, and vice versa.
  const isTrioField =
    patch.field === "skippedVersion" ||
    patch.field === "remindAt" ||
    patch.field === "approvedVersion"
  const versionTrio = isTrioField
    ? {
        skippedVersion: patch.field === "skippedVersion" ? patch.value : null,
        remindAt: patch.field === "remindAt" ? patch.value : null,
        approvedVersion: patch.field === "approvedVersion" ? patch.value : null,
      }
    : {
        skippedVersion: existing?.skippedVersion ?? null,
        remindAt: existing?.remindAt ?? null,
        approvedVersion: existing?.approvedVersion ?? null,
      }
  const acknowledgedAdvisories =
    patch.field === "acknowledgedAdvisories"
      ? patch.value
      : (existing?.acknowledgedAdvisories ?? null)

  const next: DecisionRow = {
    key,
    repo: identity.repo,
    kind: identity.kind,
    name: identity.name,
    source: identity.source,
    ...versionTrio,
    acknowledgedAdvisories,
    updatedAt: now,
    updatedBy,
  }

  db.exec("BEGIN")
  try {
    db.prepare(
      `INSERT INTO decisions
        (key, repo, kind, name, source, skippedVersion, remindAt, approvedVersion, acknowledged_json, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         repo = excluded.repo, kind = excluded.kind, name = excluded.name, source = excluded.source,
         skippedVersion = excluded.skippedVersion, remindAt = excluded.remindAt,
         approvedVersion = excluded.approvedVersion, acknowledged_json = excluded.acknowledged_json,
         updatedAt = excluded.updatedAt, updatedBy = excluded.updatedBy`,
    ).run(
      next.key,
      next.repo,
      next.kind,
      next.name,
      next.source,
      next.skippedVersion,
      next.remindAt,
      next.approvedVersion,
      next.acknowledgedAdvisories ? JSON.stringify(next.acknowledgedAdvisories) : null,
      next.updatedAt,
      next.updatedBy,
    )
    db.prepare(
      "INSERT INTO decision_history (key, before_json, after_json, at, by) VALUES (?, ?, ?, ?, ?)",
    ).run(key, existing ? JSON.stringify(existing) : null, JSON.stringify(next), now, updatedBy)
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    throw err
  }

  return { ok: true, decision: next }
}
