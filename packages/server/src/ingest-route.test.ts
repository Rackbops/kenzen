import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { mountIngestRoute } from "./ingest-route.js"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })
const TOKEN = "correct-token"

function testApp(): { app: Hono; db: DatabaseSync } {
  const { db } = openState({ dbFile: ":memory:", migrationsDir, log: silent })
  const app = new Hono()
  mountIngestRoute(app, { db, ingestToken: TOKEN, log: silent })
  return { app, db }
}

const validInventory = {
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

const validReport = {
  generatedAt: "2026-01-01T00:00:00Z",
  inventoryItems: 1,
  items: [
    {
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
    },
  ],
  repos: {},
  summary: {},
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 1,
    generatedAt: validReport.generatedAt,
    inventory: validInventory,
    report: validReport,
    ...overrides,
  }
}

function post(app: Hono, body: unknown, token = TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (token !== null) {
    headers.authorization = `Bearer ${token}`
  }
  return app.request("/api/ingest", { method: "POST", headers, body: JSON.stringify(body) })
}

describe("POST /api/ingest -- auth", () => {
  it("401s with no Authorization header", async () => {
    const { app } = testApp()
    const res = await app.request("/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody()),
    })
    expect(res.status).toBe(401)
  })

  it("401s with the wrong bearer token", async () => {
    const { app } = testApp()
    const res = await post(app, validBody(), "wrong-token")
    expect(res.status).toBe(401)
    expect((await res.json()) as { apiVersion: number }).toMatchObject({ apiVersion: 1 })
  })

  it("401s when the token is right-length but wrong-content (exercises the equal-length compare branch)", async () => {
    const { app } = testApp()
    const res = await post(app, validBody(), "x".repeat(TOKEN.length))
    expect(res.status).toBe(401)
  })

  it("succeeds with the correct token", async () => {
    const { app } = testApp()
    const res = await post(app, validBody())
    expect(res.status).toBe(200)
  })
})

describe("POST /api/ingest -- schema validation", () => {
  it("422s a malformed JSON body", async () => {
    const { app } = testApp()
    const res = await app.request("/api/ingest", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "{not json",
    })
    expect(res.status).toBe(422)
  })

  it("422s an unsupported apiVersion", async () => {
    const { app } = testApp()
    const res = await post(app, validBody({ apiVersion: 2 }))
    expect(res.status).toBe(422)
  })

  // Backs kenzen#6's acceptance bullet: "schema violation -> 422 naming the path."
  it("422s an inventory schema violation and names the failing path", async () => {
    const { app } = testApp()
    const badInventory = { ...validInventory, items: [{ repo: "o/r" }] } // missing required fields
    const res = await post(app, validBody({ inventory: badInventory }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { apiVersion: number; error: string; path: string }
    expect(body.apiVersion).toBe(1)
    expect(body.error).toContain("inventory")
    expect(body.path).toMatch(/items\/0/)
  })

  it("422s a report schema violation and names the failing path", async () => {
    const { app } = testApp()
    const badReport = { ...validReport, items: [{ key: "x" }] }
    const res = await post(app, validBody({ report: badReport }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { path: string }
    expect(body.path).toMatch(/items\/0/)
  })

  it("422s a report item with no matching inventory item (the join-level check, not ajv)", async () => {
    const { app } = testApp()
    const orphanReport = {
      ...validReport,
      items: [{ ...validReport.items[0], key: "o/r|npm-dep|ghost|package.json:99" }],
    }
    const res = await post(app, validBody({ report: orphanReport }))
    expect(res.status).toBe(422)
    expect(((await res.json()) as { error: string }).error).toContain("ghost")
  })
})

describe("POST /api/ingest -- idempotency", () => {
  it("a second identical POST returns 200 with the same snapshotId", async () => {
    const { app } = testApp()
    const first = await post(app, validBody())
    const second = await post(app, validBody())
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = (await first.json()) as { snapshotId: number }
    const secondBody = (await second.json()) as { snapshotId: number }
    expect(secondBody.snapshotId).toBe(firstBody.snapshotId)
  })
})
