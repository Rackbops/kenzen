import { Card } from "@rackbops/ui-react"

/**
 * Design.md section 6, section 5 ("History"): for any item, its pins and gaps across
 * snapshots; for any repo, the soundness line over time.
 *
 * TODO(kenzen#16): real data needs `GET /api/items/:key/history` (K4-4's item-level read API,
 * design.md section 4.3), landing in parallel with this PR. Fixture-shaped placeholder data
 * below (that endpoint's own documented row shape) until it exists.
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
