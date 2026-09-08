import { Card } from "@rackbops/ui-react"

/**
 * Design.md section 6, section 1 ("Needs a decision"): items with `advisoryStatus = affected`
 * (not acknowledged) first, then `gap` without a decision, each row with the four inline
 * decision actions.
 *
 * TODO(K4-8a): `/api/snapshots/:id/items` (kenzen#16) and the decisions API (kenzen#7, K4-5)
 * both merged to main while this PR was in review -- the data this route needs now genuinely
 * exists. Left as fixture-shaped placeholder data (design.md section 4.3's ReportItem shape)
 * deliberately, not because the data is unavailable: the real rendering here (the `DataTable`,
 * filters, and the four inline decision actions) is explicitly K4-8a/K4-9's job per this
 * issue's own scope, not this shell's -- wiring a throwaway simple version now would only be
 * replaced wholesale when that lands.
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
