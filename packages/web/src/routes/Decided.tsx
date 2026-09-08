import { Button, Card } from "@rackbops/ui-react"

/**
 * Design.md section 6, section 3 ("Decided"): skipped, snoozed, approved-pending, with the
 * decision and who/when; a *clear* action.
 *
 * TODO(kenzen#7): real data needs the decisions API (K4-5, `GET /api/decisions`,
 * design.md section 4.3), not yet landed. Fixture-shaped placeholder data below (that
 * endpoint's own documented row shape) until it exists; the *clear* action itself is K4-9's
 * job, not this shell -- the Button here is a non-functional placeholder proving the layout,
 * not a wired action yet.
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
