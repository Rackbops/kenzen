import { describe, expect, it } from "vitest"
import type { Decision, SuppressionItem } from "./suppression.js"
import { effectiveAdvisoryStatus, isNewer, parseVersion, suppressionState } from "./suppression.js"

function item(overrides: Partial<SuppressionItem> = {}): SuppressionItem {
  return {
    pinned: "1.0.0",
    latest: "1.0.0",
    advisoryStatus: "none",
    advisories: [],
    ...overrides,
  }
}

const NOW = "2026-06-01T00:00:00.000Z"

describe("parseVersion / isNewer", () => {
  it("parses a dotted-integer sequence with an optional leading v and trailing suffix", () => {
    expect(parseVersion("1.2.3")).toEqual({ numbers: [1, 2, 3] })
    expect(parseVersion("v1.2.3")).toEqual({ numbers: [1, 2, 3] })
    expect(parseVersion("22")).toEqual({ numbers: [22] })
    expect(parseVersion("2026.8.3")).toEqual({ numbers: [2026, 8, 3] })
    expect(parseVersion("1.2.3-alpine")).toEqual({ numbers: [1, 2, 3] })
  })

  it("is null for anything with no numeric-leading version (Tooling's own carve-out cases)", () => {
    expect(parseVersion("latest")).toBeNull()
    expect(parseVersion("lts/*")).toBeNull()
    expect(parseVersion("main")).toBeNull()
    expect(parseVersion("")).toBeNull()
  })

  it("zero-pads the shorter side before comparing, matching software_digest.py's _is_newer", () => {
    expect(isNewer("2.1.0", "2")).toBe(true) // 2.1.0 > 2.0.0
    expect(isNewer("2", "2.1.0")).toBe(false)
    expect(isNewer("2", "2.0.0")).toBe(false) // equal once padded
  })

  it("is conservatively false when either side is unparseable -- never un-suppress on a guess", () => {
    expect(isNewer("latest", "1.0.0")).toBe(false)
    expect(isNewer("1.0.0", "latest")).toBe(false)
    expect(isNewer(null, "1.0.0")).toBe(false)
    expect(isNewer("1.0.0", null)).toBe(false)
  })

  it("is false for an equal pair, including differently-spelled equal values", () => {
    expect(isNewer("2.0.0", "2.0.0")).toBe(false)
    expect(isNewer("v2.0.0", "2.0.0")).toBe(false)
  })
})

describe("suppressionState: no decision", () => {
  it("is always active with no decision on record", () => {
    expect(suppressionState(item(), null, NOW)).toBe("active")
    expect(suppressionState(item(), undefined, NOW)).toBe("active")
  })
})

/**
 * skippedVersion: design.md section 5 / plan.md K4-5 "the table test enumerates newer/equal/
 * older targets". Reference semantics (line numbers verified against the real source, not
 * recalled -- Tooling#478 K4-5 review round 1 found three of these citations wrong):
 *  - rackbops-discord-bot `decidePluginUpdates` (updates.ts:109): `else if (to === p.skippedVersion)
 *    action = "none"` -- exact equality, because the bot's own `to` is always gated to already
 *    be the single newest version in its index (`compareSemver(entry.version, from) <= 0) continue`
 *    at updates.ts:105, just above it), so "equal to skipped" and "not yet strictly newer than
 *    skipped" coincide in every case the bot's architecture can reach.
 *  - Tooling `software_digest.py` `suppression_state` (lines 249-254): `if not _is_newer(item.get
 *    ("latest"), skipped): return "suppressed"` -- the general "not yet strictly newer" form.
 * Kenzen follows Tooling's general form (see suppression.ts's own docstring for the one
 * documented divergence from the bot this creates, exercised explicitly below).
 */
describe("suppressionState: skippedVersion (newer / equal / older)", () => {
  it("newer than skipped -> active (both bot and Tooling agree: this is the escape hatch)", () => {
    const decision: Decision = { skippedVersion: "1.0.0" }
    expect(suppressionState(item({ latest: "2.0.0" }), decision, NOW)).toBe("active")
  })

  it("equal to skipped -> suppressed (both bot and Tooling agree)", () => {
    const decision: Decision = { skippedVersion: "1.0.0" }
    expect(suppressionState(item({ latest: "1.0.0" }), decision, NOW)).toBe("suppressed")
  })

  it("older than skipped -> suppressed (Tooling's rule; documented divergence from the bot)", () => {
    // Tooling: _is_newer("0.9.0", "1.0.0") is false -> suppressed. The bot's own equality check
    // (to === skippedVersion) would read "0.9.0" !== "1.0.0" as NOT matched and fall through to
    // notify -- a case the bot's architecture can only reach via a registry regression (its own
    // `to` is otherwise always the current newest), which is exactly why the two are allowed to
    // differ only here. Kenzen follows Tooling, since GET /api/decisions is Tooling's consumer.
    const decision: Decision = { skippedVersion: "1.0.0" }
    expect(suppressionState(item({ latest: "0.9.0" }), decision, NOW)).toBe("suppressed")
  })
})

/**
 * remindAt: bot (updates.ts:111) `else if (p.remindAt !== undefined && now.getTime() >=
 * Date.parse(p.remindAt)) action = "remind"`; Tooling (software_digest.py:262-263) `if str
 * (remind_at) <= now: return "remind"` else `"suppressed"`. "newer/equal/older" reads here as
 * "now relative to remindAt": before / exactly at / after the instant.
 */
describe("suppressionState: remindAt (before / at / after the instant)", () => {
  it("now before remindAt -> suppressed (snoozed, not yet due)", () => {
    const decision: Decision = { remindAt: "2026-06-02T00:00:00.000Z" }
    expect(suppressionState(item(), decision, NOW)).toBe("suppressed")
  })

  it("now exactly at remindAt -> remind (both bot's >= and Tooling's <= are inclusive)", () => {
    const decision: Decision = { remindAt: NOW }
    expect(suppressionState(item(), decision, NOW)).toBe("remind")
  })

  it("now after remindAt -> remind", () => {
    const decision: Decision = { remindAt: "2026-05-01T00:00:00.000Z" }
    expect(suppressionState(item(), decision, NOW)).toBe("remind")
  })

  it("compares parsed instants, not raw strings -- a precision mismatch must not invert the result", () => {
    // "2026-06-01T00:00:00Z" (no ms) is lexicographically LESS than "...T00:00:00.000Z" is
    // FALSE as strings in the wrong direction for this pair, but as instants they're equal --
    // due. A raw string comparison here would have been a real, silent correctness bug.
    const decision: Decision = { remindAt: "2026-06-01T00:00:00Z" }
    expect(suppressionState(item(), decision, "2026-06-01T00:00:00.000Z")).toBe("remind")
  })
})

/**
 * approvedVersion: Kenzen-specific (design.md section 5 table), no bot/Tooling reference --
 * "suppressed until `pinned` moves (the PR merged) or `latest` passes the approved version."
 * "newer/equal/older" here reads as `latest` against `approvedVersion`, crossed with whether
 * `pinned` has moved from `approvedFromPinned` (the value captured at approval time).
 */
describe("suppressionState: approvedVersion (newer / equal / older, against the approved target)", () => {
  it("latest below the approved target and pinned unchanged -> suppressed (PR pending)", () => {
    const decision: Decision = { approvedVersion: "2.0.0", approvedFromPinned: "1.0.0" }
    expect(suppressionState(item({ pinned: "1.0.0", latest: "1.5.0" }), decision, NOW)).toBe(
      "suppressed",
    )
  })

  it("latest equal to the approved target and pinned unchanged -> suppressed (PR pending)", () => {
    const decision: Decision = { approvedVersion: "2.0.0", approvedFromPinned: "1.0.0" }
    expect(suppressionState(item({ pinned: "1.0.0", latest: "2.0.0" }), decision, NOW)).toBe(
      "suppressed",
    )
  })

  it("pinned changed from what it was at approval time -> active (the PR landed)", () => {
    const decision: Decision = { approvedVersion: "2.0.0", approvedFromPinned: "1.0.0" }
    expect(suppressionState(item({ pinned: "2.0.0", latest: "2.0.0" }), decision, NOW)).toBe(
      "active",
    )
  })

  it("latest newer than the approved version -> active (superseded before the PR landed)", () => {
    const decision: Decision = { approvedVersion: "2.0.0", approvedFromPinned: "1.0.0" }
    expect(suppressionState(item({ pinned: "1.0.0", latest: "3.0.0" }), decision, NOW)).toBe(
      "active",
    )
  })

  it("no approvedFromPinned on record -> pinned-moved can never fire, falls back to latest alone", () => {
    // Decided before an item ever existed for this key (design.md section 4.2 allows this),
    // so there was nothing to capture a baseline `pinned` from.
    const decision: Decision = { approvedVersion: "2.0.0", approvedFromPinned: null }
    expect(suppressionState(item({ pinned: "2.0.0", latest: "2.0.0" }), decision, NOW)).toBe(
      "suppressed",
    )
  })

  it("REGRESSION (Tooling#478 K4-5 review round 1, HIGH): a major/floating pinStyle's merged PR is detected", () => {
    // `pinned` is stored verbatim for a non-exact pinStyle (software_inventory.py) -- it goes
    // from "^14.27.0" to "^14.28.0", never to a bare "14.28.0" equal to `approvedVersion`. A
    // first version of this code compared `item.pinned === decision.approvedVersion` directly,
    // which can NEVER be true here -- the item would stay suppressed forever even after the PR
    // merged. Comparing against the captured `approvedFromPinned` baseline instead correctly
    // detects the change regardless of pinStyle.
    const decision: Decision = { approvedVersion: "14.28.0", approvedFromPinned: "^14.27.0" }
    const merged = item({ pinned: "^14.28.0", latest: "14.28.0" })
    expect(suppressionState(merged, decision, NOW)).toBe("active")
  })
})

describe("suppressionState: trio precedence", () => {
  it("checks skippedVersion before remindAt before approvedVersion when more than one is set", () => {
    // putDecision (decisions.ts) never actually stores more than one of the trio at once, but
    // suppressionState itself is defensive about the (otherwise unreachable) case.
    const decision: Decision = {
      skippedVersion: "1.0.0",
      remindAt: "2099-01-01T00:00:00.000Z",
      approvedVersion: "1.0.0",
    }
    expect(suppressionState(item({ latest: "1.0.0" }), decision, NOW)).toBe("suppressed")
  })
})

/**
 * acknowledgedAdvisories: per-advisory, not whole-item (design.md section 5), so there is no
 * version to be "newer/equal/older" than -- the analogous three cases are: the affected
 * advisory IS acknowledged, a DIFFERENT advisory is acknowledged (not the affected one), and no
 * decision at all.
 */
describe("effectiveAdvisoryStatus", () => {
  const affectedItem = item({
    advisoryStatus: "affected",
    advisories: [
      { id: "GHSA-aaaa", affected: true },
      { id: "GHSA-bbbb", affected: false },
    ],
  })

  it("no decision -> unchanged", () => {
    expect(effectiveAdvisoryStatus(affectedItem, null)).toBe("affected")
  })

  it("the affected advisory is acknowledged -> historical-only", () => {
    const decision: Decision = { acknowledgedAdvisories: ["GHSA-aaaa"] }
    expect(effectiveAdvisoryStatus(affectedItem, decision)).toBe("historical-only")
  })

  it("a different (non-affected) advisory is acknowledged -> still affected", () => {
    const decision: Decision = { acknowledgedAdvisories: ["GHSA-bbbb"] }
    expect(effectiveAdvisoryStatus(affectedItem, decision)).toBe("affected")
  })

  it("a non-affected item is returned unchanged regardless of any acknowledgement", () => {
    const clean = item({ advisoryStatus: "historical-only" })
    expect(effectiveAdvisoryStatus(clean, { acknowledgedAdvisories: ["anything"] })).toBe(
      "historical-only",
    )
  })

  it("an empty advisories array with no acknowledgement leaves affected untouched", () => {
    // A real snapshot never pairs advisoryStatus="affected" with an empty advisories list (it's
    // derived FROM that list), but the function must not depend on that invariant to answer
    // the common "nothing acknowledged yet" case correctly.
    expect(
      effectiveAdvisoryStatus(item({ advisoryStatus: "affected", advisories: [] }), null),
    ).toBe("affected")
  })
})
