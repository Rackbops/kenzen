import { expect, test } from "vitest"
import {
  ApiVersionError,
  fetchJson,
  fetchLatestSnapshot,
  fetchLatestSnapshotItems,
  fetchRepos,
  fetchSnapshotItems,
  SUPPORTED_API_VERSION,
} from "./api.js"

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch
}

/** Dispatches on a substring of the requested URL, for a test that needs two different real
 * endpoints (fetchLatestSnapshotItems calls /api/snapshots then /api/snapshots/:id/items) to
 * return two different bodies -- fakeFetch alone can't express that. */
function fakeFetchByUrl(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.entries(routes).find(([substr]) => url.includes(substr))
    if (!match) {
      throw new Error(`fakeFetchByUrl: no route configured matching ${url}`)
    }
    return new Response(JSON.stringify(match[1]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
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

test("fetchLatestSnapshot returns the (only, newest-first) snapshot in the array", async () => {
  const snapshot = {
    snapshotId: 3,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 12,
    summary: {},
  }
  await expect(
    fetchLatestSnapshot(fakeFetch({ apiVersion: SUPPORTED_API_VERSION, snapshots: [snapshot] })),
  ).resolves.toEqual(snapshot)
})

test("fetchLatestSnapshot returns null when nothing has been ingested yet", async () => {
  await expect(
    fetchLatestSnapshot(fakeFetch({ apiVersion: SUPPORTED_API_VERSION, snapshots: [] })),
  ).resolves.toBeNull()
})

test("fetchSnapshotItems returns the items array for that snapshot", async () => {
  const items = [
    {
      key: "Rackbops/Tooling|pip-dep|requests|requirements.txt:3",
      repo: "Rackbops/Tooling",
      kind: "pip-dep",
      name: "requests",
      pinned: "2.31.0",
      pinStyle: "exact",
      role: "runtime",
      source: "requirements.txt:3",
      latest: "2.32.3",
      latestInMajor: "2.32.3",
      gap: "minor",
      advisoryStatus: "none",
      advisories: [],
      assumed: null,
      note: null,
      decision: null,
    },
  ]
  await expect(
    fetchSnapshotItems(3, fakeFetch({ apiVersion: SUPPORTED_API_VERSION, snapshotId: 3, items })),
  ).resolves.toEqual(items)
})

test("fetchLatestSnapshotItems composes fetchLatestSnapshot then fetchSnapshotItems for that id", async () => {
  const snapshot = {
    snapshotId: 7,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 1,
    summary: {},
  }
  const items = [{ key: "k", repo: "r", kind: "npm-dep", name: "n" }]
  const fetchImpl = fakeFetchByUrl({
    "/api/snapshots?limit=1": { apiVersion: SUPPORTED_API_VERSION, snapshots: [snapshot] },
    "/api/snapshots/7/items": { apiVersion: SUPPORTED_API_VERSION, snapshotId: 7, items },
  })
  await expect(fetchLatestSnapshotItems(fetchImpl)).resolves.toEqual({ snapshot, items })
})

test("fetchLatestSnapshotItems returns null without fetching items when there is no snapshot", async () => {
  const fetchImpl = fakeFetchByUrl({
    "/api/snapshots?limit=1": { apiVersion: SUPPORTED_API_VERSION, snapshots: [] },
  })
  await expect(fetchLatestSnapshotItems(fetchImpl)).resolves.toBeNull()
})
