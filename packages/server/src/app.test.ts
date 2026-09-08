import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createApp } from "./app.js"

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/public")

describe("createApp", () => {
  it("GET /healthz returns {ok, version, apiVersion} exactly (design.md section 4.3)", async () => {
    const app = createApp({ version: "1.2.3", staticDir: fixtureDir })
    const res = await app.request("/healthz")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({ ok: true, version: "1.2.3", apiVersion: 1 })
  })

  it("GET / serves the SPA's index.html", async () => {
    const app = createApp({ version: "0.0.0", staticDir: fixtureDir })
    const res = await app.request("/")
    expect(res.status).toBe(200)
    expect(await res.text()).toContain("kenzen-fixture-index")
  })
})
