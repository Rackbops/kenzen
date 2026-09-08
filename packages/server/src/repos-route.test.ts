import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { putDecision } from "./decisions.js"
import { ingest } from "./ingest.js"
import { createLogger } from "./log.js"
import { mountReposRoute } from "./repos-route.js"
import { openState } from "./state.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })

function testApp(): { app: Hono; db: DatabaseSync } {
  const { db } = openState({ dbFile: ":memory:", migrationsDir, log: silent })
  const app = new Hono()
  mountReposRoute(app, db)
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

describe("GET /api/repos", () => {
  it("returns an empty list before any ingest", async () => {
    const { app } = testApp()
    const res = await app.request("/api/repos")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ apiVersion: 1, repos: [] })
  })

  it("reports counts by role, gap, advisoryStatus, and the Dependabot read-back for the latest snapshot", async () => {
    const { app, db } = testApp()
    ingest(
      db,
      {
        repos: ["o/r"],
        readOnly: [],
        items: [
          invItem({ name: "a", source: "f:1", role: "runtime" }),
          invItem({ name: "b", source: "f:2", role: "build" }),
        ],
      },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 2,
        items: [
          repItem({
            key: "o/r|npm-dep|a|f:1",
            name: "a",
            source: "f:1",
            role: "runtime",
            gap: "major",
            advisoryStatus: "affected",
          }),
          repItem({
            key: "o/r|npm-dep|b|f:2",
            name: "b",
            source: "f:2",
            role: "build",
            gap: "none",
            advisoryStatus: "none",
          }),
        ],
        repos: { "o/r": { dependabotAlerts: "not enabled" } },
        summary: {},
      },
    )

    const res = await app.request("/api/repos")
    const body = (await res.json()) as { apiVersion: number; repos: Record<string, unknown>[] }
    expect(body.apiVersion).toBe(1)
    expect(body.repos).toHaveLength(1)
    const repo = body.repos[0] as {
      repo: string
      role: Record<string, number>
      gap: Record<string, number>
      advisoryStatus: Record<string, number>
      dependabotAlerts: unknown
      soundness: string
    }
    expect(repo.repo).toBe("o/r")
    expect(repo.role).toEqual({ runtime: 1, build: 1 })
    expect(repo.gap).toEqual({ major: 1, none: 1 })
    expect(repo.advisoryStatus).toEqual({ affected: 1, none: 1 })
    expect(repo.dependabotAlerts).toBe("not enabled")
    expect(repo.soundness).toBe("2 items · 1 affected · 1 behind (1/0/0) · 0 decided · 0 unknown")
  })

  it("only reflects the LATEST snapshot, not older ones", async () => {
    const { app, db } = testApp()
    ingest(
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
    ingest(
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

    const res = await app.request("/api/repos")
    const body = (await res.json()) as { repos: { gap: Record<string, number> }[] }
    expect(body.repos[0]?.gap).toEqual({ none: 1 }) // not { major: 1 } from the first snapshot
  })

  it("K4-5: a suppressing decision moves an item from behind/affected into decided", async () => {
    const { app, db } = testApp()
    ingest(
      db,
      {
        repos: ["o/r"],
        readOnly: [],
        items: [invItem({ name: "a", source: "f:1" }), invItem({ name: "b", source: "f:2" })],
      },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 2,
        items: [
          repItem({
            key: "o/r|npm-dep|a|f:1",
            name: "a",
            source: "f:1",
            latest: "9.0.0",
            gap: "major",
            advisoryStatus: "none",
          }),
          repItem({
            key: "o/r|npm-dep|b|f:2",
            name: "b",
            source: "f:2",
            gap: "none",
            advisoryStatus: "affected",
            advisories: [
              {
                id: "GHSA-x",
                summary: "s",
                severity: "high",
                url: "u",
                source: "ghsa",
                affected: true,
              },
            ],
          }),
        ],
        repos: {},
        summary: {},
      },
    )

    const before = (await (await app.request("/api/repos")).json()) as {
      repos: {
        gap: Record<string, number>
        advisoryStatus: Record<string, number>
        decided: number
      }[]
    }
    expect(before.repos[0]).toMatchObject({
      gap: { major: 1, none: 1 },
      advisoryStatus: { none: 1, affected: 1 },
      decided: 0,
    })

    // Skip item "a"'s gap (latest 9.0.0 not yet passed by the skip target) and acknowledge
    // item "b"'s only advisory -- both should move out of behind/affected and into decided.
    putDecision(
      db,
      "o/r|npm-dep|a|f:1",
      { field: "skippedVersion", value: "9.0.0" },
      "alice",
      "2026-06-01T00:00:00.000Z",
    )
    putDecision(
      db,
      "o/r|npm-dep|b|f:2",
      { field: "acknowledgedAdvisories", value: ["GHSA-x"] },
      "alice",
      "2026-06-01T00:00:00.000Z",
    )

    const after = (await (await app.request("/api/repos")).json()) as {
      repos: {
        gap: Record<string, number>
        advisoryStatus: Record<string, number>
        decided: number
        soundness: string
      }[]
    }
    expect(after.repos[0]?.gap.major ?? 0).toBe(0)
    expect(after.repos[0]?.advisoryStatus.affected ?? 0).toBe(0)
    expect(after.repos[0]?.decided).toBe(2)
    expect(after.repos[0]?.soundness).toBe(
      "2 items · 0 affected · 0 behind (0/0/0) · 2 decided · 0 unknown",
    )
  })

  it("includes a repo with Dependabot data but zero tracked items", async () => {
    const { app, db } = testApp()
    ingest(
      db,
      { repos: ["o/r", "empty/repo"], readOnly: [], items: [invItem()] },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 1,
        items: [repItem()],
        repos: { "empty/repo": { dependabotAlerts: [] } },
        summary: {},
      },
    )

    const res = await app.request("/api/repos")
    const body = (await res.json()) as { repos: { repo: string }[] }
    const repoNames = body.repos.map((r) => r.repo).sort()
    expect(repoNames).toEqual(["empty/repo", "o/r"])
  })
})
