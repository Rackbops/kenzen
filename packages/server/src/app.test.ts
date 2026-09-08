import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import type { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { createApp } from "./app.js"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/public")
const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const TOKEN = "test-token"

function testApp(): { app: Hono; db: DatabaseSync } {
  const { db } = openState({
    dbFile: ":memory:",
    migrationsDir,
    log: createLogger({ write: () => {} }),
  })
  const app = createApp({
    version: "1.2.3",
    staticDir: fixtureDir,
    db,
    ingestToken: TOKEN,
    log: createLogger({ write: () => {} }),
  })
  return { app, db }
}

describe("createApp", () => {
  it("GET /healthz returns {ok, version, apiVersion} exactly (design.md section 4.3)", async () => {
    const { app } = testApp()
    const res = await app.request("/healthz")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ ok: true, version: "1.2.3", apiVersion: 1 })
  })

  it("GET / serves the SPA's index.html", async () => {
    const { app } = testApp()
    const res = await app.request("/")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("kenzen-fixture-index")
  })

  // Found by an adversarial review: without app.onError, an error escaping a route (e.g. a
  // real DB exception) fell through to Hono's own default handler -- plain text, breaking
  // this app's own "every response carries apiVersion: 1" contract on exactly the path that
  // most needs the caller to be able to parse it as JSON. Forces a REAL exception (a closed
  // db connection, so the ingest route's own query throws) rather than mocking anything.
  it("onError catches a real thrown exception and still returns JSON with apiVersion", async () => {
    const lines: string[] = []
    const { db } = openState({
      dbFile: ":memory:",
      migrationsDir,
      log: createLogger({ write: () => {} }),
    })
    const app = createApp({
      version: "1.2.3",
      staticDir: fixtureDir,
      db,
      ingestToken: TOKEN,
      log: createLogger({ write: (l) => lines.push(l) }),
    })
    db.close() // any query against this db now throws "database is not open"

    const res = await app.request("/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        apiVersion: 1,
        generatedAt: "2026-01-01T00:00:00Z",
        inventory: { repos: [], readOnly: [], items: [] },
        report: {
          generatedAt: "2026-01-01T00:00:00Z",
          inventoryItems: 0,
          items: [],
          repos: {},
          summary: {},
        },
      }),
    })

    expect(res.status).toBe(500)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ apiVersion: 1, error: "internal error" })

    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    const errorLog = records.find((r) => r.msg === "unhandled error")
    expect(errorLog).toBeDefined()
    expect(String(errorLog?.error)).toMatch(/database is not open/i)
  })

  it("mounts /api/ingest and /api/repos, wired to the real db passed in", async () => {
    const { app } = testApp()

    const emptyRepos = await app.request("/api/repos")
    expect(await emptyRepos.json()).toEqual({ apiVersion: 1, repos: [] })

    const body = {
      apiVersion: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      inventory: { repos: ["o/r"], readOnly: [], items: [] },
      report: {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 0,
        items: [],
        repos: {},
        summary: {},
      },
    }
    const res = await app.request("/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ apiVersion: 1, snapshotId: 1, items: 0 })
  })
})
