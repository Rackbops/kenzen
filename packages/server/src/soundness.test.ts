import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createLogger } from "@rackbops/node-app-kit/log"
import { openState } from "@rackbops/node-app-kit/state"
import { describe, expect, it } from "vitest"
import { ingest } from "./ingest.js"
import { aggregateSoundness, computeRepoSummaries, type RepoSummary } from "./soundness.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })

function testDb(): DatabaseSync {
  return openState({ dbFile: ":memory:", migrationsDir, log: silent }).db
}

function repoSummary(overrides: Partial<RepoSummary> = {}): RepoSummary {
  return {
    repo: "o/r",
    role: {},
    gap: {},
    advisoryStatus: {},
    dependabotAlerts: "not enabled",
    decided: 0,
    soundness: "",
    ...overrides,
  }
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

describe("aggregateSoundness", () => {
  it("is all zeros for no repos", () => {
    expect(aggregateSoundness([])).toEqual({
      items: 0,
      affected: 0,
      behind: { major: 0, minor: 0, patch: 0 },
      decided: 0,
      unknown: 0,
    })
  })

  it("a single repo's aggregate equals that repo's own numbers", () => {
    const repo = repoSummary({
      role: { runtime: 3 },
      gap: { patch: 1 },
      advisoryStatus: { none: 3 },
    })
    expect(aggregateSoundness([repo])).toEqual({
      items: 3,
      affected: 0,
      behind: { major: 0, minor: 0, patch: 1 },
      decided: 0,
      unknown: 0,
    })
  })

  // Same fixture, same expected numbers as packages/web/src/routes/History.test.tsx's
  // "the estate line sums the per-repo counts the server computed" (estateSoundness) --
  // kenzen#38's own acceptance bullet 2 is that the two never disagree; this is that check at
  // the unit level, independent of a live boot.
  it("matches the client's estateSoundness on the exact same fixture (kenzen#38 acceptance bullet 2)", () => {
    const repos = [
      repoSummary({ role: { runtime: 3 }, gap: { patch: 1 }, advisoryStatus: { none: 3 } }),
      repoSummary({
        repo: "Rackbops/kenzen",
        role: { runtime: 1, ci: 1 },
        gap: { major: 1, unknown: 1 },
        advisoryStatus: { affected: 1 },
        decided: 2,
      }),
    ]
    expect(aggregateSoundness(repos)).toEqual({
      items: 5,
      affected: 1,
      behind: { major: 1, minor: 0, patch: 1 },
      decided: 2,
      unknown: 1,
    })
  })

  it("sums every gap bucket, minor included (mirrors estateSoundness's own review-round-1 regression guard)", () => {
    const repo = repoSummary({ role: { runtime: 6 }, gap: { major: 1, minor: 2, patch: 3 } })
    expect(aggregateSoundness([repo]).behind).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it("counts items across every role, not just runtime", () => {
    const repo = repoSummary({ role: { runtime: 1, ci: 2, test: 4 } })
    expect(aggregateSoundness([repo]).items).toBe(7)
  })
})

describe("computeRepoSummaries", () => {
  it("computes for a NAMED (not just the latest) snapshot id", () => {
    const db = testDb()
    const first = ingest(
      db,
      { repos: ["o/r"], readOnly: [], items: [invItem()] },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 1,
        items: [repItem({ gap: "major" })],
        repos: {},
        summary: {},
      },
    )
    const second = ingest(
      db,
      { repos: ["o/r"], readOnly: [], items: [invItem()] },
      {
        generatedAt: "2026-01-02T00:00:00Z",
        inventoryItems: 1,
        items: [repItem({ gap: "none" })],
        repos: {},
        summary: {},
      },
    )
    if (!first.ok || !second.ok) {
      throw new Error("test setup: ingest failed")
    }

    // Asking for the FIRST snapshot by id must return ITS gap (major), not the second (later)
    // ingest's -- proving this is genuinely parametrized by snapshotId, not silently always
    // reading "the latest" the way the pre-extraction inline version in repos-route.ts did.
    const firstRepos = computeRepoSummaries(db, first.snapshotId)
    expect(firstRepos[0]?.gap).toEqual({ major: 1 })

    const secondRepos = computeRepoSummaries(db, second.snapshotId)
    expect(secondRepos[0]?.gap).toEqual({ none: 1 })
  })

  it("returns an empty array for a snapshot id with no items (e.g. one inserted before this feature)", () => {
    const db = testDb()
    expect(computeRepoSummaries(db, 999)).toEqual([])
  })

  it("the optional repo parameter scopes the result to just that repo (kenzen#38 review round 1, HIGH: was previously computed for every repo then discarded down to one)", () => {
    const db = testDb()
    const outcome = ingest(
      db,
      {
        repos: ["o/a", "o/b", "o/c"],
        readOnly: [],
        items: [
          invItem({ repo: "o/a" }),
          invItem({ repo: "o/b", source: "f:1" }),
          invItem({ repo: "o/c", source: "f:2" }),
        ],
      },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 3,
        items: [
          repItem({ key: "o/a|npm-dep|foo|package.json:1", repo: "o/a", gap: "major" }),
          repItem({ key: "o/b|npm-dep|foo|f:1", repo: "o/b", source: "f:1", gap: "minor" }),
          repItem({ key: "o/c|npm-dep|foo|f:2", repo: "o/c", source: "f:2", gap: "patch" }),
        ],
        repos: {},
        summary: {},
      },
    )
    if (!outcome.ok) {
      throw new Error("test setup: ingest failed")
    }

    // Unscoped: all three repos, matching /api/repos' own existing (unchanged) behavior.
    expect(computeRepoSummaries(db, outcome.snapshotId).map((r) => r.repo)).toEqual([
      "o/a",
      "o/b",
      "o/c",
    ])

    // Scoped: exactly the one requested repo, not "all three, then pick one" -- this is the
    // actual mechanism the fix changed, not just the HTTP-level response shape (which the
    // repos-route.ts tests already covered before this fix existed).
    const scoped = computeRepoSummaries(db, outcome.snapshotId, "o/b")
    expect(scoped).toHaveLength(1)
    expect(scoped[0]?.repo).toBe("o/b")
    expect(scoped[0]?.gap).toEqual({ minor: 1 })
  })

  it("an unknown repo, scoped, returns an empty array rather than every repo", () => {
    const db = testDb()
    const outcome = ingest(
      db,
      { repos: ["o/r"], readOnly: [], items: [invItem()] },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 1,
        items: [repItem()],
        repos: {},
        summary: {},
      },
    )
    if (!outcome.ok) {
      throw new Error("test setup: ingest failed")
    }
    expect(computeRepoSummaries(db, outcome.snapshotId, "never/ingested")).toEqual([])
  })
})
