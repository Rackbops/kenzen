import { Card } from "@rackbops/ui-react"
import { fetchRepos, type RepoSummary } from "../api.js"
import { useAsync } from "../useAsync.js"

/** Design.md section 6, section 4 ("Dependabot read-back") -- real data: `/api/repos`'s
 * `dependabotAlerts` field is Tooling's own read-back, already shipped (K4-4). */
export function Dependabot() {
  const state = useAsync(() => fetchRepos(), [])

  if (state.status === "loading") {
    return <p>Loading Dependabot read-back…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load Dependabot read-back: {state.error.message}</p>
  }
  return <DependabotList repos={state.data} />
}

function DependabotList({ repos }: { repos: RepoSummary[] }) {
  if (repos.length === 0) {
    return <p>No repos ingested yet.</p>
  }
  return (
    <div>
      {repos.map((r) => (
        <Card key={r.repo}>
          <h3>{r.repo}</h3>
          <p>{formatAlerts(r.dependabotAlerts)}</p>
        </Card>
      ))}
    </div>
  )
}

function formatAlerts(alerts: unknown): string {
  if (alerts === "not enabled") {
    return "not enabled"
  }
  if (Array.isArray(alerts)) {
    return `${alerts.length} alert(s)`
  }
  return "unknown"
}
