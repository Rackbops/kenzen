import type { Advisory } from "./api.js"

/**
 * design.md section 6, section 2: "advisory ids link to osv.dev / GitHub" -- also named
 * explicitly in kenzen#10's own Scope line ("advisory links"), alongside source links
 * (sourceLink.ts), which K4-8a round 1 shipped without its sibling (round 2, MEDIUM: a real
 * scope gap, not a design deferral -- fixed here).
 *
 * Unlike source links, no URL construction is needed: each real Advisory already carries its
 * own `url` from Tooling's ingest (an osv.dev or GitHub advisory page, per `source: "osv" |
 * "ghsa"`) -- this just renders it. Shown for every non-empty advisories list regardless of
 * `advisoryStatus` (a historical-only item's advisories are exactly as linkable as an
 * affected one's -- the status just changes whether it's currently actionable).
 */
export function AdvisoryList({ advisories }: { advisories: Advisory[] }) {
  if (advisories.length === 0) {
    return null
  }
  return (
    <span>
      {advisories.map((advisory, index) => (
        <span key={advisory.id}>
          {index > 0 && ", "}
          <a href={advisory.url} target="_blank" rel="noreferrer" title={advisory.summary}>
            {advisory.id}
          </a>
        </span>
      ))}
    </span>
  )
}
