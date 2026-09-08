import { expect, test } from "vitest"
import { ApiVersionError, fetchJson, fetchRepos, SUPPORTED_API_VERSION } from "./api.js"

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch
}

test("fetchJson returns the body when apiVersion matches", async () => {
  const body = { apiVersion: SUPPORTED_API_VERSION, ok: true }
  await expect(fetchJson("/x", fakeFetch(body))).resolves.toEqual(body)
})

test("fetchJson throws ApiVersionError when apiVersion is missing", async () => {
  await expect(fetchJson("/x", fakeFetch({ ok: true }))).rejects.toBeInstanceOf(ApiVersionError)
})

test("fetchJson throws ApiVersionError when apiVersion doesn't match", async () => {
  await expect(fetchJson("/x", fakeFetch({ apiVersion: 999 }))).rejects.toThrow(
    /unsupported apiVersion 999/,
  )
})

test("fetchJson throws a plain error on a non-ok response, before parsing apiVersion", async () => {
  await expect(fetchJson("/x", fakeFetch({}, 500))).rejects.toThrow(/GET \/x -> 500/)
})

test("fetchRepos returns the repos array from a real-shaped /api/repos response", async () => {
  const repos = [
    {
      repo: "Rackbops/Tooling",
      role: { runtime: 3 },
      gap: { patch: 1 },
      advisoryStatus: { none: 3 },
      dependabotAlerts: "not enabled",
      soundness: "3 items · 0 affected · 1 behind (0/0/1) · 0 decided · 0 unknown",
    },
  ]
  await expect(
    fetchRepos(fakeFetch({ apiVersion: SUPPORTED_API_VERSION, repos })),
  ).resolves.toEqual(repos)
})
