/**
 * The decision model's suppression rules (design.md section 5), implemented once as pure
 * functions so both the API layer (this PR) and any future digest/UI consumer share one
 * verdict. Semantics are copied from `rackbops-discord-bot/src/plugins/updates.ts`
 * `decidePluginUpdates` (skippedVersion/remindAt) and generalized to match Tooling's
 * `software_digest.py` `suppression_state` exactly (the shape `GET /api/decisions` is built
 * for) -- both are cited in full in this PR's table test.
 *
 * One deliberate, documented divergence from the bot: the bot checks `to === skippedVersion`
 * (exact equality), because its own `to` is always gated to already be the single newest
 * available version. `isNewer` below generalizes that to "is the candidate strictly newer",
 * matching Tooling's `_is_newer` exactly. The two verdicts coincide in every case the bot's
 * own code can actually reach; they diverge only in a rollback-shaped case the bot's
 * architecture cannot express at all (a candidate OLDER than the skipped version -- e.g. a
 * registry re-publishing a lower version number) -- see the table test for the worked example.
 * Kenzen follows Tooling's more general rule since `GET /api/decisions` is Tooling's own
 * consumer, per design.md section 4.3.
 */

export interface SuppressionItem {
  pinned: string | null
  latest: string | null
  advisoryStatus: string | null
  advisories: { id: string; affected: boolean }[]
}

export interface Decision {
  skippedVersion?: string | null
  remindAt?: string | null
  approvedVersion?: string | null
  acknowledgedAdvisories?: string[] | null
}

export type SuppressionVerdict = "active" | "remind" | "suppressed"

interface ParsedVersion {
  numbers: number[]
}

// Same grammar as Tooling's `_VERSION_RE`/`_VERSION_SUFFIX` (software_report.py): an optional
// leading `v`, a dotted-integer sequence, an optional `-suffix` ignored for ordering.
const VERSION_RE = /^v?(\d+(?:\.\d+)*)(?:-[A-Za-z][\w.]*)?$/

export function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION_RE.exec(text.trim())
  const numbers = match?.[1]
  if (numbers === undefined) {
    return null
  }
  return { numbers: numbers.split(".").map(Number) }
}

/**
 * True when `candidate` is a strictly newer version than `baseline`. Mirrors Tooling's
 * `_is_newer` (software_digest.py): unparseable on either side is conservatively `false`
 * (never un-suppress on a guess), and shorter number lists are zero-padded before a
 * position-by-position comparison (`"2"` vs `"2.1.0"` compares as `2.0.0` vs `2.1.0`).
 */
export function isNewer(
  candidate: string | null | undefined,
  baseline: string | null | undefined,
): boolean {
  if (!candidate || !baseline) {
    return false
  }
  const a = parseVersion(candidate)
  const b = parseVersion(baseline)
  if (a === null || b === null) {
    return false
  }
  const width = Math.max(a.numbers.length, b.numbers.length)
  for (let i = 0; i < width; i++) {
    const an = a.numbers[i] ?? 0
    const bn = b.numbers[i] ?? 0
    if (an !== bn) {
      return an > bn
    }
  }
  return false
}

/**
 * `"active"` (needs a decision, or none of it applies), `"remind"` (a `remindAt` has come due
 * -- surface it, flagged as a reminder rather than brand-new), or `"suppressed"` (a skip still
 * holds, a remind isn't due yet, or an approval is still pending).
 *
 * Unlike Tooling's `suppression_state`, this takes no `fired` map: Kenzen's decisions API
 * never sends a notification itself (Tooling's digest does, and owns "have I already told
 * them" on its own side), so a due reminder simply reads `"remind"` every time until the
 * decision changes -- exactly the signature plan.md K4-5 specifies
 * (`suppressionState(item, decision, now)`).
 *
 * `now`/`remindAt` are compared as parsed instants, not raw strings (both must be valid
 * ISO-8601 UTC per PUT-time validation, but a `remindAt` submitted without the millisecond
 * precision `now`'s own `toISOString()` always carries would sort wrong under a plain string
 * comparison -- `"2026-10-01T00:00:00Z" < "2026-10-01T00:00:00.500Z"` is false lexicographically
 * even though the left side is the earlier instant).
 */
export function suppressionState(
  item: SuppressionItem,
  decision: Decision | null | undefined,
  now: string,
): SuppressionVerdict {
  if (!decision) {
    return "active"
  }

  if (decision.skippedVersion != null) {
    return isNewer(item.latest, decision.skippedVersion) ? "active" : "suppressed"
  }

  if (decision.remindAt != null) {
    return Date.parse(now) < Date.parse(decision.remindAt) ? "suppressed" : "remind"
  }

  if (decision.approvedVersion != null) {
    // design.md section 5: "suppressed until `pinned` moves (the PR merged) or `latest`
    // passes the approved version." There is no stored baseline of what `pinned` was AT
    // approval time (the decisions table has no snapshot reference), so "pinned moves" is
    // read as "pinned now equals what was approved" -- the expected shape of a merged PR --
    // rather than "differs from some remembered prior value".
    const prLanded = item.pinned === decision.approvedVersion
    const supersededByNewer = isNewer(item.latest, decision.approvedVersion)
    return prLanded || supersededByNewer ? "active" : "suppressed"
  }

  return "active"
}

/**
 * `acknowledgedAdvisories` is per-advisory-id, not whole-item (design.md section 5), so it
 * can't fit `suppressionState`'s single item-level verdict -- a second pure function instead.
 * Reuses the existing `"historical-only"` status value for "advisories exist but none
 * currently apply" rather than inventing a new one, since that's already its documented
 * meaning (design.md section 4.1) and every consumer already handles it.
 */
export function effectiveAdvisoryStatus(
  item: SuppressionItem,
  decision: Decision | null | undefined,
): string | null {
  if (item.advisoryStatus !== "affected") {
    return item.advisoryStatus
  }
  const acknowledged = decision?.acknowledgedAdvisories
  // Nothing acknowledged: the item's own status stands untouched, full stop -- this function's
  // job is only to compute what changes BECAUSE of an acknowledgement, so with none on record
  // there is nothing to recompute (and nothing to make this depend on `item.advisories` for).
  if (acknowledged === null || acknowledged === undefined || acknowledged.length === 0) {
    return "affected"
  }
  const ackSet = new Set(acknowledged)
  const stillAffected = item.advisories.some((a) => a.affected && !ackSet.has(a.id))
  return stillAffected ? "affected" : "historical-only"
}
