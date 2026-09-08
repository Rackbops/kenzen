import { Card } from "@rackbops/ui-react"

/**
 * Design.md section 6, section 5 ("History"): for any item, its pins and gaps across
 * snapshots; for any repo, the soundness line over time.
 *
 * TODO(K4-8b): `GET /api/items/:key/history` (kenzen#16, design.md section 4.3) merged to
 * main while this PR was in review -- the data this route needs now genuinely exists. Left
 * as fixture-shaped placeholder data deliberately, not because the data is unavailable: the
 * real rendering here (per-item history and the per-repo soundness line over time, on real
 * snapshot data) is K4-8b's job per this issue's own scope, not this shell's.
 */

interface HistoryEntry {
  generatedAt: string
  pinned: string
  latest: string | null
  gap: "none" | "patch" | "minor" | "major" | "unknown"
  advisoryStatus: "affected" | "historical-only" | "none" | "unknown"
}

const FIXTURE_HISTORY: HistoryEntry[] = [
  {
    generatedAt: "2026-09-01T00:00:00Z",
    pinned: "2.31.0",
    latest: "2.32.3",
    gap: "minor",
    advisoryStatus: "none",
  },
]

export function History() {
  if (FIXTURE_HISTORY.length === 0) {
    return <p>No history yet.</p>
  }
  return (
    <div>
      {FIXTURE_HISTORY.map((entry) => (
        <Card key={entry.generatedAt}>
          <p>{entry.generatedAt}</p>
          <p>
            {entry.pinned} → {entry.latest ?? "?"} ({entry.gap})
          </p>
        </Card>
      ))}
    </div>
  )
}
