import { Card } from "@rackbops/ui-react"

/**
 * Design.md section 6, section 1 ("Needs a decision"): items with `advisoryStatus = affected`
 * (not acknowledged) first, then `gap` without a decision, each row with the four inline
 * decision actions.
 *
 * TODO(kenzen#16, kenzen#7): real data needs `/api/snapshots/:id/items` (kenzen#16, K4-4's
 * item-level read API -- landing in parallel with this PR) joined against the decisions API
 * (kenzen#7, K4-5, not yet landed either) to know which items are undecided. Fixture-shaped
 * placeholder data below (design.md section 4.3's ReportItem shape) until both exist; the
 * inline decision actions themselves are K4-9's job, not this shell.
 */

interface NeedsDecisionItem {
  key: string
  repo: string
  kind: string
  name: string
  pinned: string
  latest: string | null
  gap: "none" | "patch" | "minor" | "major" | "unknown"
  advisoryStatus: "affected" | "historical-only" | "none" | "unknown"
}

const FIXTURE_ITEMS: NeedsDecisionItem[] = [
  {
    key: "Rackbops/Tooling|pip-dep|requests|requirements.txt:3",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    name: "requests",
    pinned: "2.31.0",
    latest: "2.32.3",
    gap: "minor",
    advisoryStatus: "none",
  },
]

export function NeedsDecision() {
  if (FIXTURE_ITEMS.length === 0) {
    return <p>Nothing needs a decision.</p>
  }
  return (
    <div>
      {FIXTURE_ITEMS.map((item) => (
        <Card key={item.key}>
          <h3>
            {item.repo} · {item.kind} {item.name}
          </h3>
          <p>
            {item.pinned} → {item.latest ?? "?"} ({item.gap})
          </p>
        </Card>
      ))}
    </div>
  )
}
