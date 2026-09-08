import { createServer, type Server } from "node:http"
import { afterEach, expect, test } from "vitest"
import { assertImage } from "../../../scripts/assert-image.mjs"

// Guards scripts/assert-image.mjs (the image ratchet's assertion logic) against fixture
// servers, so it runs on the plain test lane with no Docker. The real image boot lives in
// .github/workflows/image-ratchet.yml.

type Route = { status?: number; type?: string; body: string }
type Routes = Record<string, Route>

let server: Server | undefined
afterEach(() => server?.close())

async function serve(routes: Routes): Promise<string> {
  server = createServer((req, res) => {
    const route = routes[req.url ?? ""]
    if (!route) {
      res.writeHead(404)
      res.end("not found")
      return
    }
    res.writeHead(route.status ?? 200, { "content-type": route.type ?? "text/plain" })
    res.end(route.body)
  })
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve))
  const addr = server?.address()
  if (!addr || typeof addr === "string") throw new Error("no server address")
  return `http://127.0.0.1:${addr.port}`
}

const SPA_HTML = "<!doctype html><html><head><title>Kenzen</title></head><body></body></html>"

function goodRoutes(overrides: Partial<Routes> = {}): Routes {
  return {
    "/healthz": {
      type: "application/json",
      body: JSON.stringify({ ok: true, version: "0.1.0-alpha.1", apiVersion: 1 }),
    },
    "/": { type: "text/html", body: SPA_HTML },
    ...overrides,
  }
}

test("passes against a real-shaped healthz + SPA", async () => {
  const base = await serve(goodRoutes())
  await expect(assertImage(base)).resolves.toEqual(["/healthz", "/"])
})

test("fails when healthz.ok is not true", async () => {
  const base = await serve(
    goodRoutes({ "/healthz": { type: "application/json", body: JSON.stringify({ ok: false }) } }),
  )
  await expect(assertImage(base)).rejects.toThrow(/"ok" is false/)
})

test("fails when healthz.version is not a string", async () => {
  const base = await serve(
    goodRoutes({
      "/healthz": {
        type: "application/json",
        body: JSON.stringify({ ok: true, version: 1, apiVersion: 1 }),
      },
    }),
  )
  await expect(assertImage(base)).rejects.toThrow(/"version" is number/)
})

test("fails when healthz.apiVersion is not 1", async () => {
  const base = await serve(
    goodRoutes({
      "/healthz": {
        type: "application/json",
        body: JSON.stringify({ ok: true, version: "0.1.0", apiVersion: 2 }),
      },
    }),
  )
  await expect(assertImage(base)).rejects.toThrow(/"apiVersion" is 2/)
})

test("fails when / is not text/html", async () => {
  const base = await serve(goodRoutes({ "/": { type: "application/json", body: "{}" } }))
  await expect(assertImage(base)).rejects.toThrow(/content-type/)
})

test("fails when / is missing the Kenzen title marker", async () => {
  const base = await serve(
    goodRoutes({ "/": { type: "text/html", body: "<!doctype html><html><body></body></html>" } }),
  )
  await expect(assertImage(base)).rejects.toThrow(/<title>Kenzen<\/title>/)
})

test("fails when a route 404s", async () => {
  const base = await serve({ "/": goodRoutes()["/"] as Route }) // /healthz missing entirely
  await expect(assertImage(base)).rejects.toThrow(/GET \/healthz -> 404/)
})
