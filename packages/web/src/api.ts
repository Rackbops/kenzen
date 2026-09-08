/**
 * The read-API data-fetching layer (K4-7, design.md section 4.3): every real Kenzen response
 * carries `apiVersion: 1`, additive-only. `fetchJson` checks it on every call so a genuine
 * break (a removed/renamed field the UI depends on) fails loudly with a clear message instead
 * of the UI silently rendering `undefined`s.
 */

export const SUPPORTED_API_VERSION = 1

export class ApiVersionError extends Error {
  constructor(got: unknown) {
    super(`unsupported apiVersion ${JSON.stringify(got)}, this UI expects ${SUPPORTED_API_VERSION}`)
    this.name = "ApiVersionError"
  }
}

interface Versioned {
  apiVersion: unknown
}

function isVersioned(body: unknown): body is Versioned {
  return typeof body === "object" && body !== null && "apiVersion" in body
}

interface ErrorBody extends Versioned {
  error: unknown
}

function isErrorBody(body: unknown): body is ErrorBody {
  return isVersioned(body) && "error" in body && typeof (body as ErrorBody).error === "string"
}

/** `path` (GET by default; pass `init` for a write), parse JSON, and assert
 * apiVersion === SUPPORTED_API_VERSION before returning it. `fetchImpl` is injected so
 * callers/tests don't depend on the real global fetch.
 *
 * On a non-ok response, surfaces the server's own `error` message (every Kenzen error body
 * carries one -- `{apiVersion, error, path?}`) rather than just the HTTP status, so a decision
 * PUT's real 401/422 reason (design.md section 4.3 / decisions-route.ts) reaches the UI's
 * rollback-with-error path intact instead of a bare "PUT ... -> 422". */
export async function fetchJson<T extends Versioned>(
  path: string,
  fetchImpl: typeof fetch = fetch,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchImpl(path, init)
  const body: unknown = await res.json().catch(() => undefined)
  if (!res.ok) {
    const method = init?.method ?? "GET"
    throw new Error(
      isErrorBody(body)
        ? `${method} ${path} -> ${res.status}: ${body.error}`
        : `${method} ${path} -> ${res.status}`,
    )
  }
  if (!isVersioned(body)) {
    throw new ApiVersionError(undefined)
  }
  if (body.apiVersion !== SUPPORTED_API_VERSION) {
    throw new ApiVersionError(body.apiVersion)
  }
  return body as T
}

/** design.md section 4.3 / packages/server/src/repos-route.ts's real, shipped shape (K4-4). */
export interface RepoSummary {
  repo: string
  role: Record<string, number>
  gap: Record<string, number>
  advisoryStatus: Record<string, number>
  dependabotAlerts: unknown
  soundness: string
}

export interface ReposResponse extends Versioned {
  repos: RepoSummary[]
}

/** GET /api/repos -- real and shipped (K4-4). Powers the per-repo soundness line and the
 * Dependabot read-back section; the two sections in design.md section 6 this package can
 * render from real data today. */
export async function fetchRepos(fetchImpl: typeof fetch = fetch): Promise<RepoSummary[]> {
  const data = await fetchJson<ReposResponse>("/api/repos", fetchImpl)
  return data.repos
}

/** design.md section 4.3 / packages/server/src/snapshots-route.ts's real, shipped shape (K4-4b). */
export interface SnapshotSummary {
  snapshotId: number
  generatedAt: string
  inventoryItems: number
  summary: unknown
}

export interface Advisory {
  id: string
  summary: string
  severity: string
  url: string
  source: "osv" | "ghsa"
  affected: boolean
}

/** The decision currently on record for an item, or null when none exists yet. Matches
 * `snapshots-route.ts`'s `toReportItem` exactly: every optional field is present with an
 * explicit `null`, not omitted (unlike `GET /api/decisions`'s own `decisionJson`, which omits
 * an unset field entirely) -- always check `!= null`, never rely on `in`/`hasOwnProperty` to
 * tell "unset" apart from "set to null" here. */
export interface ItemDecision {
  skippedVersion: string | null
  remindAt: string | null
  approvedVersion: string | null
  acknowledgedAdvisories: string[] | null
  updatedAt: string
  updatedBy: string | null
}

/** design.md section 4.1's ReportItem, as `snapshots-route.ts`'s `toReportItem` actually
 * shapes it -- every field nullable except `key`/`repo`/`kind`/`name`, matching an inventory
 * item that has no matching report row (design.md section 4.2: "stored ... with
 * latest/gap/advisoryStatus null"). K4-8a (this package) reads these as given; deciding
 * whether an existing `decision` still suppresses this item is deliberately NOT done here --
 * that suppression-aware display and the interactive decision actions themselves are K4-9's
 * scope (design.md section 5's decision-effect table), so "needs a decision" in this child
 * means the simpler, unambiguous "no decision recorded at all yet".
 */
export interface ReportItem {
  key: string
  repo: string
  kind: string
  name: string
  pinned: string | null
  pinStyle: "exact" | "major" | "floating" | null
  role: "runtime" | "test" | "build" | "ci" | "infra" | null
  source: string | null
  latest: string | null
  latestInMajor: string | null
  gap: "none" | "patch" | "minor" | "major" | "unknown" | null
  advisoryStatus: "affected" | "historical-only" | "none" | "unknown" | null
  advisories: Advisory[]
  assumed: string | null
  note: string | null
  decision: ItemDecision | null
}

/** GET /api/snapshots?limit=1 -- the newest snapshot, or null when nothing has been ingested
 * yet (an empty `snapshots` array, per snapshots-route.ts). */
export async function fetchLatestSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<SnapshotSummary | null> {
  const data = await fetchJson<{ apiVersion: 1; snapshots: SnapshotSummary[] }>(
    "/api/snapshots?limit=1",
    fetchImpl,
  )
  return data.snapshots[0] ?? null
}

/** GET /api/snapshots/:id/items -- every ReportItem in that snapshot, joined with its current
 * decision. No filter query params: this UI fetches the full set once per page load and
 * filters/groups it client-side (see the route components), rather than round-tripping per
 * filter change. */
export async function fetchSnapshotItems(
  snapshotId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ReportItem[]> {
  const data = await fetchJson<{ apiVersion: 1; snapshotId: number; items: ReportItem[] }>(
    `/api/snapshots/${snapshotId}/items`,
    fetchImpl,
  )
  return data.items
}

/** Composes fetchLatestSnapshot + fetchSnapshotItems -- the one call NeedsDecision and Repos
 * both make. Null when nothing has been ingested yet (no snapshot to show items for). */
export async function fetchLatestSnapshotItems(
  fetchImpl: typeof fetch = fetch,
): Promise<{ snapshot: SnapshotSummary; items: ReportItem[] } | null> {
  const snapshot = await fetchLatestSnapshot(fetchImpl)
  if (!snapshot) {
    return null
  }
  const items = await fetchSnapshotItems(snapshot.snapshotId, fetchImpl)
  return { snapshot, items }
}

/** design.md section 5 / decisions-route.ts's real PUT body: exactly one of these fields.
 * `clear` is deliberately not modeled here -- K4-9's scope is the four inline actions
 * (skip/remind/approve/acknowledge); a clear action belongs to the Decided page (K4-8b). */
export type DecisionPatch =
  | { field: "skippedVersion"; value: string }
  | { field: "remindAt"; value: string }
  | { field: "approvedVersion"; value: string }
  | { field: "acknowledgedAdvisories"; value: string[] }

function patchBody(patch: DecisionPatch): Record<string, string | string[]> {
  return { [patch.field]: patch.value }
}

/** PUT /api/decisions/:key, design.md sections 4.3/5. `key` is `repo|kind|name|source` and is
 * URL-encoded here -- callers pass the raw key, never a pre-encoded one. Identity (`updatedBy`)
 * is resolved server-side from the Access JWT (or a dev-identity fallback) -- this function
 * never sends one; an unauthenticated caller gets the real 401 `fetchJson` now surfaces with
 * its actual message intact. Returns the persisted decision (or null after a clear, which this
 * type doesn't expose -- see DecisionPatch). */
export async function putDecision(
  key: string,
  patch: DecisionPatch,
  fetchImpl: typeof fetch = fetch,
): Promise<ItemDecision | null> {
  const data = await fetchJson<{ apiVersion: 1; decision: ItemDecision | null }>(
    `/api/decisions/${encodeURIComponent(key)}`,
    fetchImpl,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patchBody(patch)),
    },
  )
  return data.decision
}
