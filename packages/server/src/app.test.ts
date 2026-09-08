import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createLogger } from "@rackbops/node-app-kit/log"
import { openState } from "@rackbops/node-app-kit/state"
import type { Hono } from "hono"
import { describe, expect, it } from "vitest"
import type { AppOptions } from "./app.js"
import { createApp } from "./app.js"

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

  // K4-6c (kenzen#44): the boot warning for a decision-writes identity path that isn't fully
  // configured. createApp always mounts the SPA fallback (no headless mode in this app), so the
  // "staticDir served" half of the issue's condition is a standing invariant, not a branch --
  // the only real input is verifyAccessJwt. This PR's own review gate went through two drafts
  // that tried to also branch on devIdentity and got it wrong both times (round 1: claimed
  // "every write" unconditionally, false when devIdentity is set and no JWT header arrives;
  // round 2's fix: claimed devIdentity makes writes succeed, false whenever a JWT header IS
  // present -- decisions-route.ts's resolveUpdatedBy rejects those outright regardless of
  // devIdentity, per decisions-route.test.ts's own "401s a JWT-bearing request when this
  // instance has no verifier configured" with devIdentity set). So the warning (and these
  // tests) deliberately does NOT vary its message on devIdentity -- these four tests confirm
  // that: the message is identical with devIdentity unset vs set, and absent in both cases once
  // verifyAccessJwt is provided.
  function bootWarnings(options: {
    verifyAccessJwt?: AppOptions["verifyAccessJwt"]
    devIdentity?: string
  }): Record<string, unknown>[] {
    const lines: string[] = []
    const { db } = openState({
      dbFile: ":memory:",
      migrationsDir,
      log: createLogger({ write: () => {} }),
    })
    createApp({
      version: "1.2.3",
      staticDir: fixtureDir,
      db,
      ingestToken: TOKEN,
      log: createLogger({ write: (l) => lines.push(l) }),
      ...options,
    })
    return lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.level === "warn")
  }

  it("warns once when verifyAccessJwt is not provided and devIdentity is unset", () => {
    const warnings = bootWarnings({})
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.msg)).toMatch(/no verified identity path/)
  })

  it("warns the same way when verifyAccessJwt is not provided even though devIdentity is set", () => {
    const warnings = bootWarnings({ devIdentity: "local-dev" })
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.msg)).toMatch(/no verified identity path/)
    expect(String(warnings[0]?.msg)).toMatch(/regardless of KENZEN_DEV_IDENTITY/)
  })

  it("does not warn when verifyAccessJwt is provided", () => {
    expect(bootWarnings({ verifyAccessJwt: async () => null })).toHaveLength(0)
  })

  it("does not warn when verifyAccessJwt is provided even alongside devIdentity", () => {
    expect(
      bootWarnings({ verifyAccessJwt: async () => null, devIdentity: "local-dev" }),
    ).toHaveLength(0)
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
