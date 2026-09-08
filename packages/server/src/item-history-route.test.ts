import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { ingest } from "./ingest.js"
import { mountItemHistoryRoute } from "./item-history-route.js"
import { createLogger } from "./log.js"
import { openState } from "./state.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })

function testApp(): { app: Hono; db: DatabaseSync } {
  const { db } = openState({ dbFile: ":memory:", migrationsDir, log: silent })
  const app = new Hono()
  mountItemHistoryRoute(app, db)
  return { app, db }
}

const KEY = "o/r|npm-dep|foo|package.json:1"

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
  invOverrides: Record<string, unknown>,
  repOverrides: Record<string, unknown>,
) {
  const outcome = ingest(
    db,
    { repos: ["o/r"], readOnly: [], items: [invItem(invOverrides)] as never },
    {
      generatedAt,
      inventoryItems: 1,
      items: [repItem(repOverrides)] as never,
      repos: {} as never,
      summary: {},
    },
  )
  if (!outcome.ok) {
    throw new Error(`test setup: ingest failed: ${outcome.error}`)
  }
  return outcome.snapshotId
}

describe("GET /api/items/:key/history", () => {
  it("returns an empty history (200, not 404) for an unknown key", async () => {
    const { app } = testApp()
    const res = await app.request(`/api/items/${encodeURIComponent("nope|nope|nope|nope")}/history`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ apiVersion: 1, key: "nope|nope|nope|nope", history: [] })
  })

  it("shows both entries, oldest first, across two ingested snapshots differing in one pin", async () => {
    const { app, db } = testApp()
    ingestSnapshot(db, "2026-01-01T00:00:00Z", {}, { pinned: "1.0.0", gap: "none" })
    // `pinned` is backfilled from the INVENTORY item, not the report item (ingest.ts's
    // insertItem call uses invItem.pinned) -- override it there, not in repOverrides.
    ingestSnapshot(db, "2026-02-01T00:00:00Z", { pinned: "1.1.0" }, { gap: "minor" })

    const res = await app.request(`/api/items/${encodeURIComponent(KEY)}/history`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      apiVersion: number
      key: string
      history: { generatedAt: string; pinned: string; gap: string }[]
    }
    expect(body.apiVersion).toBe(1)
    expect(body.key).toBe(KEY)
    expect(body.history).toHaveLength(2)
    expect(body.history.map((h) => h.generatedAt)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-02-01T00:00:00Z",
    ])
    expect(body.history[0]).toMatchObject({ pinned: "1.0.0", gap: "none" })
    expect(body.history[1]).toMatchObject({ pinned: "1.1.0", gap: "minor" })
  })

  it("orders oldest first even when snapshots are ingested out of chronological order (mutation target: ORDER BY generatedAt ASC)", async () => {
    const { app, db } = testApp()
    // Ingested newer-first on purpose: proves ordering is by generatedAt, not insertion/id order.
    ingestSnapshot(db, "2026-03-01T00:00:00Z", { pinned: "2.0.0" }, {})
    ingestSnapshot(db, "2026-01-01T00:00:00Z", { pinned: "1.0.0" }, {})

    const res = await app.request(`/api/items/${encodeURIComponent(KEY)}/history`)
    const body = (await res.json()) as { history: { generatedAt: string }[] }
    expect(body.history.map((h) => h.generatedAt)).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-03-01T00:00:00Z",
    ])
  })

  it("round-trips a key containing both '/' and '|' via encodeURIComponent (Hono decodes :key with decodeURIComponent)", async () => {
    const { app, db } = testApp()
    const slashKey =
      "Rackbops/rackbops-discord-bot|compose-image|cloudflare/cloudflared|docker-compose.yml:12"
    ingest(
      db,
      {
        repos: ["Rackbops/rackbops-discord-bot"],
        readOnly: [],
        items: [
          {
            repo: "Rackbops/rackbops-discord-bot",
            kind: "compose-image",
            name: "cloudflare/cloudflared",
            pinned: "2024.1.0",
            pinStyle: "exact",
            role: "infra",
            source: "docker-compose.yml:12",
            resolver: "dockerhub",
          },
        ] as never,
      },
      {
        generatedAt: "2026-01-01T00:00:00Z",
        inventoryItems: 1,
        items: [
          {
            key: slashKey,
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
            advisories: [],
            assumed: null,
            note: "",
          },
        ] as never,
        repos: {} as never,
        summary: {},
      },
    )

    const res = await app.request(`/api/items/${encodeURIComponent(slashKey)}/history`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { key: string; history: { pinned: string }[] }
    expect(body.key).toBe(slashKey)
    expect(body.history).toHaveLength(1)
    expect(body.history[0]?.pinned).toBe("2024.1.0")
  })

  it("an un-encoded '/' in the key does not reach this route (falls through to the catch-all instead)", async () => {
    // Documents the failure mode named in item-history-route.ts's docstring: this test app has
    // no SPA catch-all mounted, so Hono's own default 404 proves the route never matched --
    // NOT this handler's 200-with-empty-history behaviour for an unknown (but validly single-
    // segment) key.
    const { app, db } = testApp()
    const slashKey = "o/r|npm-dep|foo|package.json:1"
    ingestSnapshot(db, "2026-01-01T00:00:00Z", {}, {})
    const res = await app.request(`/api/items/${slashKey}/history`)
    expect(res.status).toBe(404)
  })
})
