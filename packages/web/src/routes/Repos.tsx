import { Card } from "@rackbops/ui-react"
import { fetchRepos, type RepoSummary } from "../api.js"
import { useAsync } from "../useAsync.js"

/**
 * Design.md section 6, section 2 ("Per repo") -- the K4-7 shell version: real data from the
 * shipped `/api/repos` (K4-4), one row per repo with its soundness line and role/gap counts.
 * The full per-item table (`kind · name · pinned · latest · gap · advisories · source`,
 * grouped by role, source/advisory links, floating-major display) is K4-8a's `DataTable` --
 * not built here, per design.md section 6's own "no bespoke shell: layout only."
 */
export function Repos() {
  const state = useAsync(() => fetchRepos(), [])

  if (state.status === "loading") {
    return <p>Loading repos…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load repos: {state.error.message}</p>
  }
  return <RepoList repos={state.data} />
}

function RepoList({ repos }: { repos: RepoSummary[] }) {
  if (repos.length === 0) {
    return <p>No repos ingested yet.</p>
  }
  return (
    <div>
      {repos.map((r) => (
        <Card key={r.repo}>
          <h3>{r.repo}</h3>
          <p>{r.soundness}</p>
        </Card>
      ))}
    </div>
  )
}
