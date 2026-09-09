import { dirname, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createLogger, type Logger } from "@rackbops/node-app-kit/log"
import { openState } from "@rackbops/node-app-kit/state"
import { Hono } from "hono"
import { describe, expect, it, vi } from "vitest"
import type { AccessIdentity, VerifyAccessJwt } from "./access-identity.js"
import { mountDecisionsRoute } from "./decisions-route.js"
import type { InventoryDoc, ReportDoc } from "./ingest.js"
import { ingest } from "./ingest.js"

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations")
const silent = createLogger({ write: () => {} })

// A key with the real repo|kind|name|source shape -- deliberately containing "/" and ":" so
// the route's encodeURIComponent/decodeURIComponent round-trip is genuinely exercised, not
// just a key that happens to already be URL-safe.
const KEY = "Rackbops/kenzen|npm-dep|hono|package.json:12"

function testApp(
  options: { verifyAccessJwt?: VerifyAccessJwt; devIdentity?: string; log?: Logger } = {},
): {
  app: Hono
  db: DatabaseSync
} {
  const { log = silent, ...rest } = options
  const { db } = openState({ dbFile: ":memory:", migrationsDir, log: silent })
  const app = new Hono()
  mountDecisionsRoute(app, { db, log, ...rest })
  return { app, db }
}

function seedItem(db: DatabaseSync): void {
  const inv: InventoryDoc = {
    repos: ["Rackbops/kenzen"],
    readOnly: [],
    items: [
      {
        repo: "Rackbops/kenzen",
        kind: "npm-dep",
        name: "hono",
        pinned: "4.0.0",
        pinStyle: "exact",
        role: "runtime",
        source: "package.json:12",
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
        repo: "Rackbops/kenzen",
        kind: "npm-dep",
        name: "hono",
        pinned: "4.0.0",
        pinStyle: "exact",
        role: "runtime",
        source: "package.json:12",
        latest: "4.1.0",
        latestInMajor: "4.1.0",
        gap: "minor",
        advisoryStatus: "none",
        advisories: [],
        assumed: null,
        note: "",
      },
    ],
    repos: {},
    summary: {},
  }
  ingest(db, inv, rep)
}

function putUrl(key: string): string {
  return `/api/decisions/${encodeURIComponent(key)}`
}

describe("GET /api/decisions", () => {
  it("is empty before any decision is made", async () => {
    const { app } = testApp({ devIdentity: "dev" })
    const res = await app.request("/api/decisions")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ apiVersion: 1, decisions: [] })
  })
})

describe("PUT /api/decisions/:key -- identity resolution", () => {
  it("401s with no JWT and no devIdentity configured", async () => {
    const { app, db } = testApp()
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(401)
  })

  it("uses devIdentity as updatedBy when no JWT is present", async () => {
    const { app, db } = testApp({ devIdentity: "local-dev" })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decision: { updatedBy: string } }
    expect(body.decision.updatedBy).toBe("local-dev")
  })

  it("401s a JWT-bearing request when this instance has no verifier configured (never trusts an unverified JWT)", async () => {
    const { app, db } = testApp({ devIdentity: "local-dev" })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "whatever" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(401)
  })

  it("verifies the JWT and uses its email as updatedBy, taking precedence over devIdentity", async () => {
    const verifyAccessJwt = vi.fn(
      async (): Promise<AccessIdentity | null> => ({
        sub: "user-sub",
        email: "user@example.com",
        isServiceToken: false,
        claims: {},
      }),
    )
    const { app, db } = testApp({ verifyAccessJwt, devIdentity: "local-dev" })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(verifyAccessJwt).toHaveBeenCalledWith("a.b.c")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decision: { updatedBy: string } }
    expect(body.decision.updatedBy).toBe("user@example.com")
  })

  it("401s when the JWT is present but fails verification, even though devIdentity is set (devIdentity is refused when a JWT is present)", async () => {
    const verifyAccessJwt = vi.fn(async (): Promise<AccessIdentity | null> => null)
    const { app, db } = testApp({ verifyAccessJwt, devIdentity: "local-dev" })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "bad" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(401)
  })

  it("falls back to sub when the verified identity has no email", async () => {
    const verifyAccessJwt = vi.fn(
      async (): Promise<AccessIdentity | null> => ({
        sub: "service-token-abc",
        email: undefined,
        isServiceToken: false,
        claims: {},
      }),
    )
    const { app, db } = testApp({ verifyAccessJwt })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    const body = (await res.json()) as { decision: { updatedBy: string } }
    expect(body.decision.updatedBy).toBe("service-token-abc")
  })

  it("falls back to sub when the verified identity has a literal empty-string email, not just an absent one (Tooling#478 K4-5 review round 1, LOW)", async () => {
    const verifyAccessJwt = vi.fn(
      async (): Promise<AccessIdentity | null> => ({
        sub: "service-token-abc",
        email: "",
        isServiceToken: false,
        claims: {},
      }),
    )
    const { app, db } = testApp({ verifyAccessJwt })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    const body = (await res.json()) as { decision: { updatedBy: string } }
    // `??` would have recorded "" here since it only falls back on null/undefined -- `||`
    // (the actual fix) treats an empty string the same as an absent claim.
    expect(body.decision.updatedBy).toBe("service-token-abc")
  })

  it("kenzen#57: 401s a verified Access service-token identity, even though it's a real (non-null) identity", async () => {
    const writes: string[] = []
    const log = createLogger({ write: (line) => writes.push(line) })
    const verifyAccessJwt = vi.fn(
      async (): Promise<AccessIdentity | null> => ({
        sub: "",
        email: undefined,
        isServiceToken: true,
        claims: { common_name: "env-health" },
      }),
    )
    const { app, db } = testApp({ verifyAccessJwt, log })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ apiVersion: 1, error: "unauthorized" })
    // Nothing written: GET still shows no decision at all.
    const get = (await (await app.request("/api/decisions")).json()) as { decisions: unknown[] }
    expect(get.decisions).toEqual([])
    // Logged a reason, never the JWT itself.
    expect(writes.some((line) => line.includes("no attributable identity"))).toBe(true)
    expect(writes.some((line) => line.includes("service token"))).toBe(true)
    expect(writes.some((line) => line.includes("a.b.c"))).toBe(false)
  })

  it("kenzen#57: 401s an identity that isn't flagged as a service token but still resolves to an empty updatedBy", async () => {
    // Defense in depth: isServiceToken is the primary signal, but a verifier implementation
    // that somehow leaves it false on an empty-claims identity must still be caught here.
    const writes: string[] = []
    const log = createLogger({ write: (line) => writes.push(line) })
    const verifyAccessJwt = vi.fn(
      async (): Promise<AccessIdentity | null> => ({
        sub: "   ",
        email: undefined,
        isServiceToken: false,
        claims: {},
      }),
    )
    const { app, db } = testApp({ verifyAccessJwt, log })
    seedItem(db)
    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(401)
    expect(writes.some((line) => line.includes("no attributable identity"))).toBe(true)
    expect(writes.some((line) => line.includes("empty claims"))).toBe(true)
  })
})

describe("GET /api/decisions -- invariant", () => {
  it("kenzen#57: never returns a decision with an empty updatedBy, even after a rejected service-token write attempt", async () => {
    const verifyAccessJwt = vi.fn(
      async (): Promise<AccessIdentity | null> => ({
        sub: "",
        email: undefined,
        isServiceToken: true,
        claims: { common_name: "env-health" },
      }),
    )
    const { app, db } = testApp({ devIdentity: "alice", verifyAccessJwt })
    seedItem(db)

    // A legitimate human write via devIdentity succeeds.
    const human = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(human.status).toBe(200)

    // A service-token write to the same key is rejected and changes nothing.
    const serviceToken = await app.request(putUrl(KEY), {
      method: "PUT",
      headers: { "Cf-Access-Jwt-Assertion": "a.b.c" },
      body: JSON.stringify({ approvedVersion: "5.0.0" }),
    })
    expect(serviceToken.status).toBe(401)

    const get = (await (await app.request("/api/decisions")).json()) as {
      decisions: { updatedBy: string }[]
    }
    expect(get.decisions.length).toBeGreaterThan(0)
    for (const decision of get.decisions) {
      expect(decision.updatedBy.trim()).not.toBe("")
    }
  })
})

describe("PUT /api/decisions/:key -- round trip and key encoding", () => {
  it("round-trips a skip, remind, approve and acknowledge, each appearing in GET /api/decisions", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)

    const skip = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(skip.status).toBe(200)

    const getAfterSkip = await app.request("/api/decisions")
    const afterSkip = (await getAfterSkip.json()) as { decisions: Record<string, unknown>[] }
    expect(afterSkip.decisions).toHaveLength(1)
    expect(afterSkip.decisions[0]).toMatchObject({ key: KEY, skippedVersion: "5.0.0" })

    const remind = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ remindAt: "2099-01-01T00:00:00.000Z" }),
    })
    expect(remind.status).toBe(200)
    const afterRemind = (await (await app.request("/api/decisions")).json()) as {
      decisions: Record<string, unknown>[]
    }
    expect(afterRemind.decisions[0]).toMatchObject({ remindAt: "2099-01-01T00:00:00.000Z" })
    expect(afterRemind.decisions[0]).not.toHaveProperty("skippedVersion")

    const approve = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ approvedVersion: "4.1.0" }),
    })
    expect(approve.status).toBe(200)

    const acknowledge = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ acknowledgedAdvisories: [] }),
    })
    expect(acknowledge.status).toBe(200)

    const clear = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ clear: true }),
    })
    expect(clear.status).toBe(200)
    const afterClear = (await (await app.request("/api/decisions")).json()) as {
      decisions: unknown[]
    }
    expect(afterClear.decisions).toEqual([])
  })

  it("an approve's response and GET /api/decisions both surface approvedFromPinned -- K4-9 round 2, HIGH: the client needs it to detect a merged PR itself", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db) // pinned: "4.0.0"

    const approve = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ approvedVersion: "4.1.0" }),
    })
    expect(approve.status).toBe(200)
    const approveBody = (await approve.json()) as { decision: Record<string, unknown> }
    expect(approveBody.decision).toMatchObject({
      approvedVersion: "4.1.0",
      approvedFromPinned: "4.0.0",
    })

    const get = await app.request("/api/decisions")
    const getBody = (await get.json()) as { decisions: Record<string, unknown>[] }
    expect(getBody.decisions[0]).toMatchObject({
      approvedVersion: "4.1.0",
      approvedFromPinned: "4.0.0",
    })
  })

  it("round-trips a real key containing '/' and ':' via encodeURIComponent/decodeURIComponent", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    expect(KEY).toContain("/")
    expect(KEY).toContain(":")

    const res = await app.request(putUrl(KEY), {
      method: "PUT",
      body: JSON.stringify({ skippedVersion: "5.0.0" }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { decision: { key: string } }
    expect(body.decision.key).toBe(KEY)
  })
})

describe("PUT /api/decisions/:key -- body validation", () => {
  async function put(app: Hono, body: unknown) {
    return app.request(putUrl(KEY), { method: "PUT", body: JSON.stringify(body) })
  }

  it("422s an empty body", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    expect((await put(app, {})).status).toBe(422)
  })

  it("422s a body with more than one recognized field", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    expect(
      (await put(app, { skippedVersion: "5.0.0", remindAt: "2099-01-01T00:00:00.000Z" })).status,
    ).toBe(422)
  })

  it("422s clear: false", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    expect((await put(app, { clear: false })).status).toBe(422)
  })

  it("422s a non-string skippedVersion", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    expect((await put(app, { skippedVersion: 5 })).status).toBe(422)
  })

  it("propagates a decisions.ts validation failure (unrecognized version string) as 422", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    expect((await put(app, { skippedVersion: "not-a-version" })).status).toBe(422)
  })

  it("422s invalid JSON", async () => {
    const { app, db } = testApp({ devIdentity: "alice" })
    seedItem(db)
    const res = await app.request(putUrl(KEY), { method: "PUT", body: "{not json" })
    expect(res.status).toBe(422)
  })
})
