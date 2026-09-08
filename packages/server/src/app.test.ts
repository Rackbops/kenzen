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
