import { expect, test } from "vitest"
import {
  ApiVersionError,
  fetchJson,
  fetchLatestSnapshot,
  fetchLatestSnapshotItems,
  fetchRepoSoundnessSeries,
  fetchRepos,
  fetchSnapshotItems,
  fetchSnapshots,
  putDecision,
  SUPPORTED_API_VERSION,
} from "./api.js"

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch
}

/** Like fakeFetch, but records the (url, init) of every call for assertions -- and the calls
 * array is the same object the test holds, so it's readable after the fact. */
function fakeFetchCapturing(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
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

test("fetchJson surfaces the server's own error message on a non-ok response, not just the status", async () => {
  await expect(
    fetchJson(
      "/api/decisions/x",
      fakeFetch({ apiVersion: SUPPORTED_API_VERSION, error: "unauthorized" }, 401),
    ),
  ).rejects.toThrow(/GET \/api\/decisions\/x -> 401: unauthorized/)
})

test("fetchJson falls back to a bare status when the non-ok body isn't a real error shape", async () => {
  await expect(fetchJson("/x", fakeFetch({ not: "an error body" }, 500))).rejects.toThrow(
    /GET \/x -> 500$/,
  )
})

test("putDecision PUTs to the encoded key with exactly the one patched field, and returns the decision", async () => {
  const decision = {
    skippedVersion: "9.0.0",
    remindAt: null,
    approvedVersion: null,
    acknowledgedAdvisories: null,
    updatedAt: "2026-09-08T00:00:00Z",
    updatedBy: "roshne",
  }
  const { fetchImpl, calls } = fakeFetchCapturing({ apiVersion: SUPPORTED_API_VERSION, decision })

  const result = await putDecision(
    "Rackbops/Tooling|pip-dep|requests|requirements.txt:3",
    { field: "skippedVersion", value: "9.0.0" },
    fetchImpl,
  )

  expect(result).toEqual(decision)
  expect(calls).toHaveLength(1)
  expect(calls[0]?.url).toBe(
    "/api/decisions/Rackbops%2FTooling%7Cpip-dep%7Crequests%7Crequirements.txt%3A3",
  )
  expect(calls[0]?.init?.method).toBe("PUT")
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ skippedVersion: "9.0.0" })
})

test("putDecision's error surfaces the server's real reason on an unauthorized write", async () => {
  await expect(
    putDecision(
      "k",
      { field: "skippedVersion", value: "9.0.0" },
      fakeFetch({ apiVersion: SUPPORTED_API_VERSION, error: "unauthorized" }, 401),
    ),
  ).rejects.toThrow(/unauthorized/)
})

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

// --- kenzen#38: soundness over time ---------------------------------------------------------

test("fetchSnapshots returns the snapshots array, each carrying its own soundness", async () => {
  const soundness = {
    items: 1,
    affected: 0,
    behind: { major: 0, minor: 0, patch: 1 },
    decided: 0,
    unknown: 0,
  }
  const snapshots = [
    {
      snapshotId: 2,
      generatedAt: "2026-09-02T00:00:00Z",
      inventoryItems: 1,
      summary: {},
      soundness,
    },
    {
      snapshotId: 1,
      generatedAt: "2026-09-01T00:00:00Z",
      inventoryItems: 1,
      summary: {},
      soundness,
    },
  ]
  await expect(
    fetchSnapshots(undefined, fakeFetch({ apiVersion: SUPPORTED_API_VERSION, snapshots })),
  ).resolves.toEqual(snapshots)
})

test("fetchSnapshots passes limit through as a query param, and omits it when absent", async () => {
  const { fetchImpl, calls } = fakeFetchCapturing({
    apiVersion: SUPPORTED_API_VERSION,
    snapshots: [],
  })
  await fetchSnapshots(30, fetchImpl)
  expect(calls[0]?.url).toBe("/api/snapshots?limit=30")

  const { fetchImpl: fetchImpl2, calls: calls2 } = fakeFetchCapturing({
    apiVersion: SUPPORTED_API_VERSION,
    snapshots: [],
  })
  await fetchSnapshots(undefined, fetchImpl2)
  expect(calls2[0]?.url).toBe("/api/snapshots")
})

test("fetchRepoSoundnessSeries returns the series array", async () => {
  const series = [
    {
      snapshotId: 1,
      generatedAt: "2026-09-01T00:00:00Z",
      soundness: {
        items: 1,
        affected: 0,
        behind: { major: 0, minor: 0, patch: 0 },
        decided: 0,
        unknown: 0,
      },
    },
    {
      snapshotId: 2,
      generatedAt: "2026-09-02T00:00:00Z",
      soundness: {
        items: 1,
        affected: 0,
        behind: { major: 1, minor: 0, patch: 0 },
        decided: 0,
        unknown: 0,
      },
    },
  ]
  await expect(
    fetchRepoSoundnessSeries(
      "Rackbops/kenzen",
      undefined,
      fakeFetch({ apiVersion: SUPPORTED_API_VERSION, repo: "Rackbops/kenzen", series }),
    ),
  ).resolves.toEqual(series)
})

test("fetchRepoSoundnessSeries encodes a repo name containing '/' into one path segment, with limit", async () => {
  const { fetchImpl, calls } = fakeFetchCapturing({
    apiVersion: SUPPORTED_API_VERSION,
    repo: "Rackbops/kenzen",
    series: [],
  })
  await fetchRepoSoundnessSeries("Rackbops/kenzen", 30, fetchImpl)
  expect(calls[0]?.url).toBe("/api/repos/Rackbops%2Fkenzen/soundness?limit=30")
})
