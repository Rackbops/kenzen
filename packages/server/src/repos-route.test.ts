import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
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
