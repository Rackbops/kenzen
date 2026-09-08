import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { InventoryDoc, ReportDoc } from "./ingest.js"
import { ingest } from "./ingest.js"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })

function freshDb(): DatabaseSync {
  return openState({ dbFile: ":memory:", migrationsDir, log: silent }).db
}

function inv(items: InventoryDoc["items"]): InventoryDoc {
  return { repos: ["o/r"], readOnly: [], items }
}

function rep(items: ReportDoc["items"], generatedAt = "2026-01-01T00:00:00Z"): ReportDoc {
  return { generatedAt, inventoryItems: items.length, items, repos: {}, summary: { note: "test" } }
}

const invItem = {
  repo: "o/r",
  kind: "npm-dep",
  name: "foo",
  pinned: "1.0.0",
  pinStyle: "exact",
  role: "runtime",
  source: "package.json:1",
  resolver: "npm",
}

const repItem = {
  key: "o/r|npm-dep|foo|package.json:1",
  repo: "o/r",
  kind: "npm-dep",
  name: "foo",
  pinned: "1.0.0",
  pinStyle: "exact",
  role: "runtime",
  source: "package.json:1",
  latest: "1.2.0",
  latestInMajor: "1.2.0",
  gap: "minor",
  advisoryStatus: "none",
  advisories: [],
  assumed: null,
  note: "",
}

describe("ingest", () => {
  it("writes a snapshot and its items in one call, backfilling resolver from the inventory item", () => {
    const db = freshDb()
    const outcome = ingest(db, inv([invItem]), rep([repItem]))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("expected ok")
    expect(outcome.items).toBe(1)

    const row = db
      .prepare("SELECT * FROM items WHERE snapshotId = ?")
      .get(outcome.snapshotId) as Record<string, unknown>
    expect(row.resolver).toBe("npm")
    expect(row.latest).toBe("1.2.0")
    expect(row.gap).toBe("minor")
    expect(row.note).toBe("")
  })

  // design.md section 4.2: "an inventory item with no report row is stored with
  // latest/gap/advisoryStatus null and note = 'not in report'."
  it("an inventory-only item (no matching report row) is stored with nulls and the synthesized note", () => {
    const db = freshDb()
    const outcome = ingest(db, inv([invItem]), rep([]))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("expected ok")

    const row = db
      .prepare("SELECT * FROM items WHERE snapshotId = ?")
      .get(outcome.snapshotId) as Record<string, unknown>
    expect(row.resolver).toBe("npm") // still backfilled -- comes from inventory, not report
    expect(row.latest).toBeNull()
    expect(row.gap).toBeNull()
    expect(row.advisoryStatus).toBeNull()
    expect(row.note).toBe("not in report")
  })

  // design.md section 4.2: "a report row with no inventory item is a 422, since the report
  // is derived from the inventory."
  it("a report item with no matching inventory item is rejected as 422, before any write", () => {
    const db = freshDb()
    const orphan = { ...repItem, key: "o/r|npm-dep|ghost|package.json:99" }
    const outcome = ingest(db, inv([invItem]), rep([repItem, orphan]))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error("expected rejection")
    expect(outcome.status).toBe(422)
    expect(outcome.error).toContain("ghost")

    // Nothing was written -- the whole ingest is one transaction, and the orphan check runs
    // before it opens.
    const count = db.prepare("SELECT COUNT(*) as c FROM snapshots").get() as { c: number }
    expect(count.c).toBe(0)
  })

  it("is idempotent on generatedAt: a repeat ingest returns the same snapshotId and writes nothing new", () => {
    const db = freshDb()
    const first = ingest(db, inv([invItem]), rep([repItem]))
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error("expected ok")

    const second = ingest(db, inv([invItem]), rep([repItem]))
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error("expected ok")
    expect(second.snapshotId).toBe(first.snapshotId)

    const snapshotCount = db.prepare("SELECT COUNT(*) as c FROM snapshots").get() as { c: number }
    expect(snapshotCount.c).toBe(1)
  })

  it("a different generatedAt creates a genuinely new snapshot, not an idempotent no-op", () => {
    const db = freshDb()
    const first = ingest(db, inv([invItem]), rep([repItem], "2026-01-01T00:00:00Z"))
    const second = ingest(db, inv([invItem]), rep([repItem], "2026-01-02T00:00:00Z"))
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error("expected ok")
    expect(second.snapshotId).not.toBe(first.snapshotId)

    const snapshotCount = db.prepare("SELECT COUNT(*) as c FROM snapshots").get() as { c: number }
    expect(snapshotCount.c).toBe(2)
  })

  it("stores the report's repos/dependabot data per snapshot", () => {
    const db = freshDb()
    const report: ReportDoc = {
      ...rep([repItem]),
      repos: { "o/r": { dependabotAlerts: "not enabled" } },
    }
    const outcome = ingest(db, inv([invItem]), report)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("expected ok")

    const row = db
      .prepare("SELECT dependabot_json FROM repos WHERE snapshotId = ? AND repo = ?")
      .get(outcome.snapshotId, "o/r") as { dependabot_json: string }
    expect(JSON.parse(row.dependabot_json)).toBe("not enabled")
  })

  it("stores advisories as JSON, round-trippable", () => {
    const db = freshDb()
    const withAdvisory = {
      ...repItem,
      advisoryStatus: "affected",
      advisories: [
        {
          id: "GHSA-x",
          summary: "s",
          severity: "high",
          url: "https://x",
          source: "ghsa",
          affected: true,
        },
      ],
    }
    const outcome = ingest(db, inv([invItem]), rep([withAdvisory]))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error("expected ok")

    const row = db
      .prepare("SELECT advisories_json FROM items WHERE snapshotId = ?")
      .get(outcome.snapshotId) as { advisories_json: string }
    expect(JSON.parse(row.advisories_json)).toEqual(withAdvisory.advisories)
  })

  it("a failed ingest (report-only item) leaves a previously-committed snapshot untouched", () => {
    const db = freshDb()
    const first = ingest(db, inv([invItem]), rep([repItem], "2026-01-01T00:00:00Z"))
    expect(first.ok).toBe(true)

    const orphan = { ...repItem, key: "o/r|npm-dep|ghost|package.json:99" }
    const second = ingest(db, inv([invItem]), rep([repItem, orphan], "2026-01-02T00:00:00Z"))
    expect(second.ok).toBe(false)

    const snapshotCount = db.prepare("SELECT COUNT(*) as c FROM snapshots").get() as { c: number }
    expect(snapshotCount.c).toBe(1) // still just the first, successful one
  })
})
