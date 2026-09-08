/**
 * The soundness line's shape (design.md section 6; Tooling#473 kenzen#38): `N items · A
 * affected · G behind (major/minor/patch) · D decided · U unknown`, typed rather than left as
 * the free-form string the line renders as. `behind`'s own total (`G` in that line) is
 * deliberately not a stored field here -- it is always `major + minor + patch`, and storing it
 * alongside the three components would let them drift out of sync; every consumer derives it.
 *
 * Shared between the server (which computes this per repo and per snapshot,
 * `packages/server/src/soundness.ts`) and the web client (which renders it, and for the estate
 * line sums per-repo instances of it client-side --
 * `packages/web/src/routes/History.tsx`'s `estateSoundness`, the reference this shape and its
 * server-side computation must never disagree with, per kenzen#38's own scope: the arithmetic
 * itself does not change here, only where it can be read from).
 */
export interface Soundness {
  items: number
  affected: number
  behind: { major: number; minor: number; patch: number }
  decided: number
  unknown: number
}
