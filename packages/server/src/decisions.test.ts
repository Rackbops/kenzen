import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { DecisionPatch } from "./decisions.js"
import { listDecisions, putDecision } from "./decisions.js"
import type { InventoryDoc, ReportDoc } from "./ingest.js"
import { ingest } from "./ingest.js"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })
const NOW = "2026-06-01T00:00:00.000Z"
const KEY = "o/r|npm-dep|foo|package.json:1"

function freshDb(): DatabaseSync {
  return openState({ dbFile: ":memory:", migrationsDir, log: silent }).db
}

function seedItem(db: DatabaseSync, overrides: Record<string, unknown> = {}): void {
  const inv: InventoryDoc = {
    repos: ["o/r"],
    readOnly: [],
    items: [
      {
        repo: "o/r",
        kind: "npm-dep",
        name: "foo",
        pinned: "1.0.0",
        pinStyle: "exact",
        role: "runtime",
        source: "package.json:1",
        resolver: "npm",
      },
    ],
  }
  const rep: ReportDoc = {
    generatedAt: "2026-01-01T00:00:00Z",
    inventoryItems: 1,
    items: [
      {
        key: KEY,
        repo: "o/r",
        kind: "npm-dep",
        name: "foo",
        pinned: "1.0.0",
        pinStyle: "exact",
        role: "runtime",
        source: "package.json:1",
        latest: "1.0.0",
        latestInMajor: "1.0.0",
        gap: "none",
        advisoryStatus: "affected",
        advisories: [
          {
            id: "GHSA-aaaa",
            summary: "x",
            severity: "high",
            url: "u",
            source: "ghsa",
            affected: true,
          },
        ],
        assumed: null,
        note: "",
        ...overrides,
      },
    ],
    repos: {},
    summary: {},
  }
  ingest(db, inv, rep)
}

describe("listDecisions", () => {
  it("is empty before any decision is made", () => {
    expect(listDecisions(freshDb())).toEqual([])
  })
})

describe("putDecision: identity and round-trip", () => {
  it("populates repo/kind/name/source from the live item when one exists", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.decision).toEqual({
      key: KEY,
      repo: "o/r",
      kind: "npm-dep",
      name: "foo",
      source: "package.json:1",
      skippedVersion: "2.0.0",
      remindAt: null,
      approvedVersion: null,
      acknowledgedAdvisories: null,
      updatedAt: NOW,
      updatedBy: "alice",
    })
    expect(listDecisions(db)).toEqual([result.decision])
  })

  it("falls back to parsing the key when no item has been ingested yet (design.md: a decision may predate its item)", () => {
    const db = freshDb()
    const result = putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.decision).toMatchObject({
      repo: "o/r",
      kind: "npm-dep",
      name: "foo",
      source: "package.json:1",
    })
  })

  it("validates acknowledgedAdvisories against the LATEST snapshot's item, not an older one's", () => {
    const db = freshDb()
    seedItem(db, {
      advisories: [
        {
          id: "GHSA-old",
          summary: "x",
          severity: "high",
          url: "u",
          source: "ghsa",
          affected: true,
        },
      ],
    })
    // A second, later ingest changes which advisory id is actually on the item.
    ingest(
      db,
      {
        repos: ["o/r"],
        readOnly: [],
        items: [
          {
            repo: "o/r",
            kind: "npm-dep",
            name: "foo",
            pinned: "1.0.0",
            pinStyle: "exact",
            role: "runtime",
            source: "package.json:1",
            resolver: "npm",
          },
        ],
      },
      {
        generatedAt: "2026-02-01T00:00:00Z",
        inventoryItems: 1,
        items: [
          {
            key: KEY,
            repo: "o/r",
            kind: "npm-dep",
            name: "foo",
            pinned: "1.0.0",
            pinStyle: "exact",
            role: "runtime",
            source: "package.json:1",
            latest: "1.0.0",
            latestInMajor: "1.0.0",
            gap: "none",
            advisoryStatus: "affected",
            advisories: [
              {
                id: "GHSA-new",
                summary: "y",
                severity: "high",
                url: "u",
                source: "ghsa",
                affected: true,
              },
            ],
            assumed: null,
            note: "",
          },
        ],
        repos: {},
        summary: {},
      },
    )

    const stale = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: ["GHSA-old"] },
      "alice",
      NOW,
    )
    expect(stale.ok).toBe(false)
    const fresh = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: ["GHSA-new"] },
      "alice",
      NOW,
    )
    expect(fresh.ok).toBe(true)
  })

  it("422s a key that neither matches a live item nor parses as repo|kind|name|source", () => {
    const db = freshDb()
    const result = putDecision(
      db,
      "not-a-real-key",
      { field: "skippedVersion", value: "2.0.0" },
      "alice",
      NOW,
    )
    expect(result).toEqual({
      ok: false,
      status: 422,
      error: expect.stringContaining("not-a-real-key"),
    })
  })
})

describe("putDecision: validation", () => {
  it("422s a skippedVersion/approvedVersion that isn't a recognizable version string", () => {
    const db = freshDb()
    seedItem(db)
    for (const field of ["skippedVersion", "approvedVersion"] as const) {
      const result = putDecision(db, KEY, { field, value: "not-a-version" }, "alice", NOW)
      expect(result.ok).toBe(false)
    }
  })

  it("422s a remindAt that isn't ISO-8601 UTC", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(db, KEY, { field: "remindAt", value: "2026-06-02" }, "alice", NOW)
    expect(result.ok).toBe(false)
  })

  it("422s a remindAt that is not in the future", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(
      db,
      KEY,
      { field: "remindAt", value: "2026-05-01T00:00:00.000Z" },
      "alice",
      NOW,
    )
    expect(result.ok).toBe(false)
  })

  it("accepts a remindAt strictly after now", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(
      db,
      KEY,
      { field: "remindAt", value: "2026-07-01T00:00:00.000Z" },
      "alice",
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it("422s an acknowledgedAdvisories id that isn't on the item", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: ["GHSA-not-real"] },
      "alice",
      NOW,
    )
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it("accepts an acknowledgedAdvisories id that IS on the item", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: ["GHSA-aaaa"] },
      "alice",
      NOW,
    )
    expect(result.ok).toBe(true)
  })

  it("422s any non-empty acknowledgedAdvisories when no item exists to check ids against", () => {
    const db = freshDb()
    const result = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: ["GHSA-aaaa"] },
      "alice",
      NOW,
    )
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it("accepts an empty acknowledgedAdvisories even with no item (vacuously valid)", () => {
    const db = freshDb()
    const result = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: [] },
      "alice",
      NOW,
    )
    expect(result.ok).toBe(true)
  })
})

describe("putDecision: trio exclusivity vs. the independent acknowledgedAdvisories axis", () => {
  it("setting remindAt after skippedVersion clears skippedVersion (design.md: 'a new target resets either')", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    const result = putDecision(
      db,
      KEY,
      { field: "remindAt", value: "2026-07-01T00:00:00.000Z" },
      "alice",
      NOW,
    )
    if (!result.ok) throw new Error("expected ok")
    expect(result.decision?.skippedVersion).toBeNull()
    expect(result.decision?.remindAt).toBe("2026-07-01T00:00:00.000Z")
  })

  it("setting acknowledgedAdvisories preserves an existing skippedVersion (a different axis)", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    const result = putDecision(
      db,
      KEY,
      { field: "acknowledgedAdvisories", value: ["GHSA-aaaa"] },
      "alice",
      NOW,
    )
    if (!result.ok) throw new Error("expected ok")
    expect(result.decision?.skippedVersion).toBe("2.0.0")
    expect(result.decision?.acknowledgedAdvisories).toEqual(["GHSA-aaaa"])
  })

  it("setting skippedVersion after acknowledgedAdvisories preserves the acknowledgement", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "acknowledgedAdvisories", value: ["GHSA-aaaa"] }, "alice", NOW)
    const result = putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    if (!result.ok) throw new Error("expected ok")
    expect(result.decision?.acknowledgedAdvisories).toEqual(["GHSA-aaaa"])
    expect(result.decision?.skippedVersion).toBe("2.0.0")
  })
})

describe("putDecision: clear", () => {
  it("deletes an existing decision", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    const result = putDecision(db, KEY, { field: "clear" }, "alice", NOW)
    expect(result).toEqual({ ok: true, decision: null })
    expect(listDecisions(db)).toEqual([])
  })

  it("is a no-op success when there was nothing to clear", () => {
    const db = freshDb()
    seedItem(db)
    const result = putDecision(db, KEY, { field: "clear" }, "alice", NOW)
    expect(result).toEqual({ ok: true, decision: null })
  })
})

describe("decision_history: append-only audit trail", () => {
  function history(db: DatabaseSync, key: string) {
    return db
      .prepare(
        "SELECT before_json, after_json, at, by FROM decision_history WHERE key = ? ORDER BY id",
      )
      .all(key) as {
      before_json: string | null
      after_json: string
      at: string
      by: string | null
    }[]
  }

  it("appends one row per write, with before/after and the resolved identity", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    putDecision(
      db,
      KEY,
      { field: "skippedVersion", value: "3.0.0" },
      "bob",
      "2026-06-02T00:00:00.000Z",
    )

    const rows = history(db, KEY)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.before_json).toBeNull()
    expect(JSON.parse(rows[0]?.after_json ?? "null")).toMatchObject({ skippedVersion: "2.0.0" })
    expect(rows[0]?.by).toBe("alice")
    expect(JSON.parse(rows[1]?.before_json ?? "null")).toMatchObject({ skippedVersion: "2.0.0" })
    expect(JSON.parse(rows[1]?.after_json ?? "null")).toMatchObject({ skippedVersion: "3.0.0" })
    expect(rows[1]?.by).toBe("bob")
  })

  it("appends a row for a clear, with after_json null", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    putDecision(db, KEY, { field: "clear" }, "alice", "2026-06-02T00:00:00.000Z")

    const rows = history(db, KEY)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.after_json).toBe("null")
    expect(JSON.parse(rows[1]?.before_json ?? "null")).toMatchObject({ skippedVersion: "2.0.0" })
  })

  it("appends no row for a no-op clear", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "clear" }, "alice", NOW)
    expect(history(db, KEY)).toHaveLength(0)
  })

  it("appends no row for a rejected (422) write", () => {
    const db = freshDb()
    seedItem(db)
    const patch: DecisionPatch = { field: "skippedVersion", value: "not-a-version" }
    putDecision(db, KEY, patch, "alice", NOW)
    expect(history(db, KEY)).toHaveLength(0)
  })

  it("survives the decision row being cleared -- history is not a foreign key (design.md/K4-3)", () => {
    const db = freshDb()
    seedItem(db)
    putDecision(db, KEY, { field: "skippedVersion", value: "2.0.0" }, "alice", NOW)
    putDecision(db, KEY, { field: "clear" }, "alice", "2026-06-02T00:00:00.000Z")
    expect(listDecisions(db)).toEqual([])
    expect(history(db, KEY)).toHaveLength(2)
  })
})
