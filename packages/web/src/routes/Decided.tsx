import { Button, Card } from "@rackbops/ui-react"

/**
 * Design.md section 6, section 3 ("Decided"): skipped, snoozed, approved-pending, with the
 * decision and who/when; a *clear* action.
 *
 * TODO(K4-8b): the decisions API (kenzen#7, K4-5, `GET /api/decisions`, design.md section
 * 4.3) merged to main while this PR was in review -- the data this route needs now genuinely
 * exists. Left as fixture-shaped placeholder data deliberately, not because the data is
 * unavailable: the real rendering here (the full "Decided" section on real snapshot data) is
 * K4-8b's job per this issue's own scope, not this shell's. The *clear* action itself is
 * K4-9's job either way -- the Button here is a non-functional placeholder proving the
 * layout, not a wired action yet.
 */

interface Decision {
  repo: string
  kind?: string
  name: string
  skippedVersion?: string
  remindAt?: string
  updatedAt: string
  updatedBy: string
}

const FIXTURE_DECISIONS: Decision[] = [
  {
    repo: "Rackbops/Tooling",
    name: "requests",
    skippedVersion: "2.32.0",
    updatedAt: "2026-09-01T00:00:00Z",
    updatedBy: "roshne",
  },
]

export function Decided() {
  if (FIXTURE_DECISIONS.length === 0) {
    return <p>No decisions recorded yet.</p>
  }
  return (
    <div>
      {FIXTURE_DECISIONS.map((d) => (
        <Card key={`${d.repo}|${d.kind ?? ""}|${d.name}`}>
          <h3>
            {d.repo} · {d.name}
          </h3>
          <p>
            {d.skippedVersion ? `Skipped until > ${d.skippedVersion}` : `Remind at ${d.remindAt}`}
            {" -- "}
            {d.updatedBy}, {d.updatedAt}
          </p>
          <Button variant="ghost" size="sm">
            Clear
          </Button>
        </Card>
      ))}
    </div>
  )
}
