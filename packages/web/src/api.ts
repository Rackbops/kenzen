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

/** GET `path`, parse JSON, and assert apiVersion === SUPPORTED_API_VERSION before returning
 * it. `fetchImpl` is injected so callers/tests don't depend on the real global fetch. */
export async function fetchJson<T extends Versioned>(
  path: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(path)
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status}`)
  }
  const body: unknown = await res.json()
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
