import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createLogger } from "@rackbops/node-app-kit/log"
import { openState } from "@rackbops/node-app-kit/state"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { putDecision } from "./decisions.js"
import { ingest } from "./ingest.js"
import { mountSnapshotsRoute } from "./snapshots-route.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })

function testApp(): { app: Hono; db: DatabaseSync } {
  const { db } = openState({ dbFile: ":memory:", migrationsDir, log: silent })
  const app = new Hono()
  mountSnapshotsRoute(app, db)
  return { app, db }
}

function invItem(overrides: Record<string, unknown> = {}) {
  return {
    repo: "o/r",
    kind: "npm-dep",
    name: "foo",
    pinned: "1.0.0",
    pinStyle: "exact",
    role: "runtime",
    source: "package.json:1",
    resolver: "npm",
    ...overrides,
  }
}

function repItem(overrides: Record<string, unknown> = {}) {
  return {
    key: "o/r|npm-dep|foo|package.json:1",
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
    advisoryStatus: "none",
    advisories: [],
    assumed: null,
    note: "",
    ...overrides,
  }
}

function ingestSnapshot(
  db: DatabaseSync,
  generatedAt: string,
  items: { inv: Record<string, unknown>; rep: Record<string, unknown> }[],
  reposEntry: Record<string, unknown> = {},
) {
  const outcome = ingest(
    db,
    { repos: ["o/r"], readOnly: [], items: items.map((i) => i.inv) as never },
    {
      generatedAt,
      inventoryItems: items.length,
      items: items.map((i) => i.rep) as never,
      repos: reposEntry as never,
      summary: { totalItems: items.length },
    },
  )
  if (!outcome.ok) {
    throw new Error(`test setup: ingest failed: ${outcome.error}`)
  }
  return outcome.snapshotId
}

/** Inserts raw snapshot rows directly (bypassing ingest's join logic, which snapshots-route.ts
 * never touches) -- used only to prove the `limit` cap without paying for 101 real ingests. */
function insertRawSnapshots(db: DatabaseSync, count: number): void {
  const insert = db.prepare(
    "INSERT INTO snapshots (generatedAt, inventoryItems, summary_json, ingestedAt) VALUES (?, ?, ?, ?)",
  )
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(4, "0")
    insert.run(`2020-01-01T00:${n}:00Z`, 0, "{}", `2020-01-01T00:${n}:00Z`)
  }
}

describe("GET /api/snapshots", () => {
  it("returns an empty list before any ingest, with apiVersion", async () => {
    const { app } = testApp()
    const res = await app.request("/api/snapshots")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ apiVersion: 1, snapshots: [] })
  })

  it("returns real snapshotId/generatedAt/inventoryItems/summary/soundness for one ingest", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [{ inv: invItem(), rep: repItem() }])

    const res = await app.request("/api/snapshots")
    const body = (await res.json()) as {
      apiVersion: number
      snapshots: {
        snapshotId: number
        generatedAt: string
        inventoryItems: number
        summary: unknown
        soundness: unknown
      }[]
    }
    expect(body.apiVersion).toBe(1)
    expect(body.snapshots).toHaveLength(1)
    expect(body.snapshots[0]).toEqual({
      snapshotId: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      inventoryItems: 1,
      summary: { totalItems: 1 },
      // kenzen#38: the default repItem() fixture is one sound, undecided, unaffected item.
      soundness: {
        items: 1,
        affected: 0,
        behind: { major: 0, minor: 0, patch: 0 },
        decided: 0,
        unknown: 0,
      },
    })
  })

  it("kenzen#38 acceptance bullet 1: two ingests with one pin changed show two soundness objects whose behind differs by exactly the changed item", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [{ inv: invItem(), rep: repItem({ gap: "none" }) }])
    ingestSnapshot(db, "2026-01-02T00:00:00Z", [
      { inv: invItem(), rep: repItem({ gap: "minor", latest: "9.0.0" }) },
    ])

    const res = await app.request("/api/snapshots")
    const body = (await res.json()) as {
      snapshots: { snapshotId: number; soundness: { behind: Record<string, number> } }[]
    }
    // Newest first (this route's own established order): snapshot 2 (the changed pin) first.
    expect(body.snapshots[0]?.snapshotId).toBe(2)
    expect(body.snapshots[0]?.soundness.behind).toEqual({ major: 0, minor: 1, patch: 0 })
    expect(body.snapshots[1]?.snapshotId).toBe(1)
    expect(body.snapshots[1]?.soundness.behind).toEqual({ major: 0, minor: 0, patch: 0 })
  })

  it("a decision made AFTER both ingests is reflected retroactively across the whole series (lazy-on-read, not frozen at ingest)", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem({ gap: "major", latest: "9.0.0" }) },
    ])
    ingestSnapshot(db, "2026-01-02T00:00:00Z", [
      { inv: invItem(), rep: repItem({ gap: "major", latest: "9.0.0" }) },
    ])
    putDecision(
      db,
      "o/r|npm-dep|foo|package.json:1",
      { field: "skippedVersion", value: "9.0.0" },
      "alice",
      "2026-06-01T00:00:00.000Z",
    )

    const res = await app.request("/api/snapshots")
    const body = (await res.json()) as {
      snapshots: {
        snapshotId: number
        soundness: { behind: Record<string, number>; decided: number }
      }[]
    }
    // BOTH snapshots reflect the current decision -- not just the one made after it, and not
    // frozen at whatever existed when each was originally ingested.
    for (const snapshot of body.snapshots) {
      expect(snapshot.soundness.behind).toEqual({ major: 0, minor: 0, patch: 0 })
      expect(snapshot.soundness.decided).toBe(1)
    }
  })

  it("orders newest first (mutation target: ORDER BY id DESC)", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [{ inv: invItem(), rep: repItem() }])
    ingestSnapshot(db, "2026-02-01T00:00:00Z", [
      {
        inv: invItem({ source: "package.json:2" }),
        rep: repItem({ key: "o/r|npm-dep|foo|package.json:2", source: "package.json:2" }),
      },
    ])
    ingestSnapshot(db, "2026-03-01T00:00:00Z", [
      {
        inv: invItem({ source: "package.json:3" }),
        rep: repItem({ key: "o/r|npm-dep|foo|package.json:3", source: "package.json:3" }),
      },
    ])

    const res = await app.request("/api/snapshots")
    const body = (await res.json()) as { snapshots: { generatedAt: string }[] }
    expect(body.snapshots.map((s) => s.generatedAt)).toEqual([
      "2026-03-01T00:00:00Z",
      "2026-02-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    ])
  })

  it("limit narrows the result set to the N newest", async () => {
    const { app, db } = testApp()
    insertRawSnapshots(db, 5)
    const res = await app.request("/api/snapshots?limit=2")
    const body = (await res.json()) as { snapshots: unknown[] }
    expect(body.snapshots).toHaveLength(2)
  })

  it("limit is capped at 100 even when a larger value is requested", async () => {
    const { app, db } = testApp()
    insertRawSnapshots(db, 150)
    const res = await app.request("/api/snapshots?limit=1000")
    const body = (await res.json()) as { snapshots: unknown[] }
    expect(body.snapshots).toHaveLength(100)
  })

  it("defaults to the 100 cap when no limit is given", async () => {
    const { app, db } = testApp()
    insertRawSnapshots(db, 150)
    const res = await app.request("/api/snapshots")
    const body = (await res.json()) as { snapshots: unknown[] }
    expect(body.snapshots).toHaveLength(100)
  })

  it.each(["0", "-1", "abc", "1.5", ""])(
    "422s a bad limit value %j, naming the parameter",
    async (bad) => {
      const { app } = testApp()
      // An empty string is the one value that means "absent" (nonEmpty convention), so skip it
      // for the negative case and prove the positive default case instead.
      if (bad === "") {
        const res = await app.request("/api/snapshots?limit=")
        expect(res.status).toBe(200)
        return
      }
      const res = await app.request(`/api/snapshots?limit=${bad}`)
      expect(res.status).toBe(422)
      const body = (await res.json()) as { apiVersion: number; path: string }
      expect(body.apiVersion).toBe(1)
      expect(body.path).toBe("limit")
    },
  )
})

describe("GET /api/snapshots/:id/items", () => {
  it("404s an unknown snapshot id", async () => {
    const { app } = testApp()
    const res = await app.request("/api/snapshots/999/items")
    expect(res.status).toBe(404)
    expect((await res.json()) as { apiVersion: number }).toMatchObject({ apiVersion: 1 })
  })

  it("404s a malformed (non-numeric) snapshot id", async () => {
    const { app } = testApp()
    const res = await app.request("/api/snapshots/abc/items")
    expect(res.status).toBe(404)
  })

  // node:sqlite silently fails to match a bound NaN (Number("abc")) against any integer row,
  // so a plain "404 for the DB miss" alone would NOT catch a dropped id-format guard -- a
  // non-canonical numeral like a leading zero coerces to a real, matchable number instead
  // (mutation target: parseSnapshotId's regex, which rejects this before any query runs).
  it("404s a leading-zero snapshot id even though Number('01') would match a real row", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [{ inv: invItem(), rep: repItem() }])
    const res = await app.request("/api/snapshots/01/items")
    expect(res.status).toBe(404)
  })

  // Distinguishes "snapshot doesn't exist" (404) from "snapshot exists but the filter matches
  // zero items" (200, empty array) -- an adversarial review on this PR asked for this case
  // explicitly, since the existence check (line ~161) and the filtered query share no state
  // that could conflate the two by accident, but nothing had proven it before this test.
  it("returns 200 with an empty items array for a filter matching nothing on a real snapshot", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem() },
    ])
    const res = await app.request(`/api/snapshots/${snapshotId}/items?repo=no/such-repo`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { apiVersion: number; items: unknown[] }
    expect(body.apiVersion).toBe(1)
    expect(body.items).toEqual([])
  })

  it("shows the real Rackbops/rackbops-discord-bot cloudflare/cloudflared item through the endpoint", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      {
        inv: {
          repo: "Rackbops/rackbops-discord-bot",
          kind: "compose-image",
          name: "cloudflare/cloudflared",
          pinned: "2024.1.0",
          pinStyle: "exact",
          role: "infra",
          source: "docker-compose.yml:12",
          resolver: "dockerhub",
        },
        rep: {
          key: "Rackbops/rackbops-discord-bot|compose-image|cloudflare/cloudflared|docker-compose.yml:12",
          repo: "Rackbops/rackbops-discord-bot",
          kind: "compose-image",
          name: "cloudflare/cloudflared",
          pinned: "2024.1.0",
          pinStyle: "exact",
          role: "infra",
          source: "docker-compose.yml:12",
          latest: "2024.6.1",
          latestInMajor: "2024.6.1",
          gap: "minor",
          advisoryStatus: "historical-only",
          advisories: [
            {
              id: "GHSA-7mjv-x3jf-545x",
              summary: "s1",
              severity: "high",
              url: "u1",
              source: "ghsa",
              affected: false,
            },
            {
              id: "GHSA-hgwp-4vp4-qmm2",
              summary: "s2",
              severity: "high",
              url: "u2",
              source: "ghsa",
              affected: false,
            },
          ],
          assumed: null,
          note: "",
        },
      },
    ])

    const res = await app.request(
      `/api/snapshots/${snapshotId}/items?repo=Rackbops/rackbops-discord-bot`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      apiVersion: number
      items: { name: string; advisories: unknown[] }[]
    }
    expect(body.apiVersion).toBe(1)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.name).toBe("cloudflare/cloudflared")
    expect(body.items[0]?.advisories).toHaveLength(2)
  })

  it("repo filter narrows the result set (mutation target: WHERE i.repo = ?)", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      {
        inv: invItem({ repo: "o/a" }),
        rep: repItem({ key: "o/a|npm-dep|foo|package.json:1", repo: "o/a" }),
      },
      {
        inv: invItem({ repo: "o/b", source: "package.json:2" }),
        rep: repItem({
          key: "o/b|npm-dep|foo|package.json:2",
          repo: "o/b",
          source: "package.json:2",
        }),
      },
    ])

    const res = await app.request(`/api/snapshots/${snapshotId}/items?repo=o/a`)
    const body = (await res.json()) as { items: { repo: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.repo).toBe("o/a")
  })

  it("kind filter narrows the result set (mutation target: WHERE i.kind = ?)", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem({ kind: "npm-dep" }), rep: repItem({ kind: "npm-dep" }) },
      {
        inv: invItem({ kind: "pip-dep", source: "requirements.txt:1" }),
        rep: repItem({
          key: "o/r|pip-dep|foo|requirements.txt:1",
          kind: "pip-dep",
          source: "requirements.txt:1",
        }),
      },
    ])

    const res = await app.request(`/api/snapshots/${snapshotId}/items?kind=pip-dep`)
    const body = (await res.json()) as { items: { kind: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.kind).toBe("pip-dep")
  })

  it("role filter narrows the result set (mutation target: WHERE i.role = ?)", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem({ role: "runtime" }), rep: repItem({ role: "runtime" }) },
      {
        inv: invItem({ role: "build", source: "package.json:2" }),
        rep: repItem({
          key: "o/r|npm-dep|foo|package.json:2",
          role: "build",
          source: "package.json:2",
        }),
      },
    ])

    const res = await app.request(`/api/snapshots/${snapshotId}/items?role=build`)
    const body = (await res.json()) as { items: { role: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.role).toBe("build")
  })

  it("status filter narrows the result set (mutation target: WHERE i.advisoryStatus = ?)", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem({ advisoryStatus: "affected" }) },
      {
        inv: invItem({ source: "package.json:2" }),
        rep: repItem({
          key: "o/r|npm-dep|foo|package.json:2",
          source: "package.json:2",
          advisoryStatus: "none",
        }),
      },
    ])

    const res = await app.request(`/api/snapshots/${snapshotId}/items?status=affected`)
    const body = (await res.json()) as { items: { advisoryStatus: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.advisoryStatus).toBe("affected")
  })

  it("combines repo + kind filters (AND, not OR)", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      {
        inv: invItem({ repo: "o/a", kind: "npm-dep" }),
        rep: repItem({ key: "o/a|npm-dep|foo|package.json:1", repo: "o/a", kind: "npm-dep" }),
      },
      {
        inv: invItem({ repo: "o/a", kind: "pip-dep", source: "requirements.txt:1" }),
        rep: repItem({
          key: "o/a|pip-dep|foo|requirements.txt:1",
          repo: "o/a",
          kind: "pip-dep",
          source: "requirements.txt:1",
        }),
      },
      {
        inv: invItem({ repo: "o/b", kind: "npm-dep", source: "package.json:2" }),
        rep: repItem({
          key: "o/b|npm-dep|foo|package.json:2",
          repo: "o/b",
          kind: "npm-dep",
          source: "package.json:2",
        }),
      },
    ])

    const res = await app.request(`/api/snapshots/${snapshotId}/items?repo=o/a&kind=npm-dep`)
    const body = (await res.json()) as { items: { repo: string; kind: string }[] }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ repo: "o/a", kind: "npm-dep" })
  })

  it.each([
    ["kind", "not-a-kind"],
    ["role", "not-a-role"],
    ["status", "not-a-status"],
  ])("422s an unknown %s value, naming the parameter", async (param, value) => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem() },
    ])
    const res = await app.request(`/api/snapshots/${snapshotId}/items?${param}=${value}`)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { apiVersion: number; path: string }
    expect(body.apiVersion).toBe(1)
    expect(body.path).toBe(param)
  })

  it("decision is null for an item with no decisions row anywhere", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem() },
    ])
    const res = await app.request(`/api/snapshots/${snapshotId}/items`)
    const body = (await res.json()) as { items: { decision: unknown }[] }
    expect(body.items[0]?.decision).toBeNull()
  })

  it("joins the current decision per key when a decisions row exists", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem() },
    ])
    db.prepare(
      `INSERT INTO decisions (key, repo, kind, name, source, skippedVersion, remindAt, approvedVersion, acknowledged_json, updatedAt, updatedBy)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    ).run(
      "o/r|npm-dep|foo|package.json:1",
      "o/r",
      "npm-dep",
      "foo",
      "package.json:1",
      "1.5.0",
      "2026-01-02T00:00:00Z",
      "roshne",
    )

    const res = await app.request(`/api/snapshots/${snapshotId}/items`)
    const body = (await res.json()) as {
      items: { decision: { skippedVersion: string | null; updatedBy: string | null } | null }[]
    }
    expect(body.items[0]?.decision).toEqual({
      skippedVersion: "1.5.0",
      remindAt: null,
      approvedVersion: null,
      approvedFromPinned: null,
      acknowledgedAdvisories: null,
      updatedAt: "2026-01-02T00:00:00Z",
      updatedBy: "roshne",
    })
  })

  it("surfaces approvedFromPinned when an approval is on record -- K4-9 round 2, HIGH: the client needs it to compute suppressionState's approvedVersion branch itself", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem() },
    ])
    putDecision(
      db,
      "o/r|npm-dep|foo|package.json:1",
      { field: "approvedVersion", value: "2.0.0" },
      "roshne",
      "2026-01-02T00:00:00Z",
    )

    const res = await app.request(`/api/snapshots/${snapshotId}/items`)
    const body = (await res.json()) as {
      items: {
        decision: { approvedVersion: string | null; approvedFromPinned: string | null } | null
      }[]
    }
    expect(body.items[0]?.decision?.approvedVersion).toBe("2.0.0")
    expect(body.items[0]?.decision?.approvedFromPinned).toBe(invItem().pinned)
  })

  it("K4-5b REGRESSION (Tooling#478 review round 1, HIGH): carries a decision over when the item's source moves, matching GET /api/repos", async () => {
    // The exact live inconsistency an adversarial reviewer found: GET /api/repos already
    // re-matched a moved item's decision (K4-5b), but this endpoint's plain `d.key = i.key`
    // join did not, so the two live endpoints disagreed about whether the item was decided.
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      {
        inv: invItem({ source: "f:1" }),
        rep: repItem({ key: "o/r|npm-dep|foo|f:1", source: "f:1" }),
      },
    ])
    putDecision(
      db,
      "o/r|npm-dep|foo|f:1",
      { field: "skippedVersion", value: "1.0.0" },
      "roshne",
      "2026-01-02T00:00:00.000Z",
    )
    // The source moves in a later ingest -- a file edit shifted the pin's line.
    const secondSnapshotId = ingestSnapshot(db, "2026-02-01T00:00:00Z", [
      {
        inv: invItem({ source: "f:9" }),
        rep: repItem({ key: "o/r|npm-dep|foo|f:9", source: "f:9" }),
      },
    ])

    const res = await app.request(`/api/snapshots/${secondSnapshotId}/items`)
    const body = (await res.json()) as {
      items: { key: string; decision: { skippedVersion: string | null } | null }[]
    }
    expect(body.items[0]?.key).toBe("o/r|npm-dep|foo|f:9")
    expect(body.items[0]?.decision?.skippedVersion).toBe("1.0.0")
  })

  it("K4-5b: two stale decisions sharing repo|kind|name resolve to the newer one by updatedAt (round-2 review gap: only unit-tested before, not at this route)", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      {
        inv: invItem({ source: "f:1" }),
        rep: repItem({ key: "o/r|npm-dep|foo|f:1", source: "f:1", latest: "5.0.0" }),
      },
    ])
    // Older, now-spent decision (skip 3.0.0, latest 5.0.0 already passed it).
    putDecision(
      db,
      "o/r|npm-dep|foo|f:1",
      { field: "skippedVersion", value: "3.0.0" },
      "alice",
      "2026-01-15T00:00:00.000Z",
    )
    ingestSnapshot(db, "2026-02-01T00:00:00Z", [
      {
        inv: invItem({ source: "f:5" }),
        rep: repItem({ key: "o/r|npm-dep|foo|f:5", source: "f:5", latest: "5.0.0" }),
      },
    ])
    // Newer decision, still holds (skip 5.0.0, not yet passed).
    putDecision(
      db,
      "o/r|npm-dep|foo|f:5",
      { field: "skippedVersion", value: "5.0.0" },
      "alice",
      "2026-02-15T00:00:00.000Z",
    )
    // Third move -- neither f:1 nor f:5 is the item's key any more.
    const thirdSnapshotId = ingestSnapshot(db, "2026-03-01T00:00:00Z", [
      {
        inv: invItem({ source: "f:9" }),
        rep: repItem({ key: "o/r|npm-dep|foo|f:9", source: "f:9", latest: "5.0.0" }),
      },
    ])

    const res = await app.request(`/api/snapshots/${thirdSnapshotId}/items`)
    const body = (await res.json()) as {
      items: { decision: { skippedVersion: string | null } | null }[]
    }
    // If the OLDER (spent) decision had won instead, skippedVersion would read "3.0.0" here.
    expect(body.items[0]?.decision?.skippedVersion).toBe("5.0.0")
  })

  it("K4-5b REGRESSION (Tooling#478 review round 1, CRITICAL): does not cross-contaminate two DISTINCT live items sharing repo|kind|name", async () => {
    // Two simultaneously-live items -- e.g. the same npm package required by two workspace
    // packages -- not one item that moved. Only one occurrence is ever decided.
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      {
        inv: invItem({ source: "packages/a/package.json:5" }),
        rep: repItem({
          key: "o/r|npm-dep|foo|packages/a/package.json:5",
          source: "packages/a/package.json:5",
        }),
      },
      {
        inv: invItem({ source: "packages/b/package.json:3" }),
        rep: repItem({
          key: "o/r|npm-dep|foo|packages/b/package.json:3",
          source: "packages/b/package.json:3",
        }),
      },
    ])
    putDecision(
      db,
      "o/r|npm-dep|foo|packages/a/package.json:5",
      { field: "skippedVersion", value: "1.0.0" },
      "roshne",
      "2026-01-02T00:00:00.000Z",
    )

    const res = await app.request(`/api/snapshots/${snapshotId}/items`)
    const body = (await res.json()) as {
      items: { key: string; decision: { skippedVersion: string | null } | null }[]
    }
    const a = body.items.find((i) => i.key === "o/r|npm-dep|foo|packages/a/package.json:5")
    const b = body.items.find((i) => i.key === "o/r|npm-dep|foo|packages/b/package.json:3")
    expect(a?.decision?.skippedVersion).toBe("1.0.0")
    // b must NOT inherit a's decision just because the name matches.
    expect(b?.decision).toBeNull()
  })

  it("apiVersion is present on the happy path and every error branch", async () => {
    const { app, db } = testApp()
    const snapshotId = ingestSnapshot(db, "2026-01-01T00:00:00Z", [
      { inv: invItem(), rep: repItem() },
    ])
    const ok = await app.request(`/api/snapshots/${snapshotId}/items`)
    expect(((await ok.json()) as { apiVersion: number }).apiVersion).toBe(1)
    const notFound = await app.request("/api/snapshots/999/items")
    expect(((await notFound.json()) as { apiVersion: number }).apiVersion).toBe(1)
    const badKind = await app.request(`/api/snapshots/${snapshotId}/items?kind=nope`)
    expect(((await badKind.json()) as { apiVersion: number }).apiVersion).toBe(1)
  })
})
