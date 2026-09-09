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
 *
 * kenzen#63: rendered every id inline and always expanded, so one item with many advisories
 * (@sveltejs/kit, 17) inflated its whole table row to ~550px tall. Collapsed by default behind
 * a native `<details>` -- the callers' own `{n} affected` Badge is already the visible summary,
 * so the id list is detail, not headline. Native disclosure over React state: keyboard-operable
 * and needs no ARIA hand-rolled. `app.css`'s `.kz-advisories-cell` (on the caller's cell
 * content) keeps the collapsed line from wrapping the row; `.kz-advisories__list` overrides
 * back to a wrapping flex row when open, so many ids take a few lines, not one column.
 */
export function AdvisoryList({ advisories }: { advisories: Advisory[] }) {
  if (advisories.length === 0) {
    return null
  }
  return (
    <details className="kz-advisories">
      <summary>show ids</summary>
      <ul className="kz-advisories__list">
        {advisories.map((advisory) => (
          <li key={advisory.id}>
            <a href={advisory.url} target="_blank" rel="noreferrer" title={advisory.summary}>
              {advisory.id}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}
