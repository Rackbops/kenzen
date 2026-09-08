import { useEffect, useMemo, useRef, useState } from "react"
import type { DecisionPatch, ItemDecision, ReportItem } from "./api.js"
import { putDecision } from "./api.js"

/**
 * design.md/kenzen#12 (K4-9): "optimistic update with rollback on error." Shared between
 * NeedsDecision.tsx and Repos.tsx -- both render decision actions on the same underlying
 * ReportItem shape and need identical apply/rollback semantics.
 *
 * `overrides` holds only the keys a decision action has touched THIS session; every other
 * item passes through from `items` unchanged. Applying a patch immediately writes a locally-
 * constructed decision into `overrides` (optimistic), then replaces it with the server's real
 * response once the PUT resolves, or removes the override (reverting to whatever `items`
 * itself says -- typically `null`, "no decision") if it rejects.
 *
 * Round 1 review (MEDIUM): `apply()` used to write its PUT's result unconditionally, so two
 * calls for the SAME key resolving out of order (a real possibility -- two real HTTP requests
 * racing) left whichever RESPONSE arrived last as the final state, not whichever ACTION the
 * user fired last. `sequenceRef` (a ref, not state -- it's bookkeeping for apply() itself, not
 * something a render should react to) gives every call for a key its own increasing number;
 * a call only commits its result if its own number is still the key's current one when the
 * PUT settles, so a stale response from a superseded call is silently dropped rather than
 * clobbering a newer one.
 *
 * Round 2 review (MEDIUM, both reviewers independently found it live): the optimistic preview
 * used to rebuild from an all-null base regardless of what was already decided, so acting on
 * ONE axis (say, Skip) transiently wiped the OTHER axis's already-confirmed value (an
 * Acknowledge summary) out of the UI until the PUT settled and the real merged response
 * replaced it -- visible flicker, briefly wrong display, only reachable now that round 1 made
 * both axes independently actionable on one row. `optimisticDecision` now merges onto
 * whatever decision the key currently has, replicating decisions.ts's own real merge rule
 * (design.md section 5: the gap trio -- skip/remind/approve -- resets together since only one
 * can hold at a time; acknowledgedAdvisories is untouched by a trio write and vice versa).
 *
 * Round 3 review (HIGH, live-reproduced): that sequence number was keyed by item key ALONE,
 * not by axis -- so starting an acknowledge while an approve on the SAME item was still in
 * flight marked the approve call "superseded" too, even though the two axes are independent
 * and both genuinely succeeded (design.md section 5: the gap trio and acknowledgedAdvisories
 * don't conflict). The approve call's own real, successful confirmed response was then
 * silently dropped when it arrived, leaving `updatedBy`/`approvedVersion` stuck on the
 * optimistic placeholder forever -- only reachable once round 1 + round 2 together made both
 * axes concurrently actionable AND correctly visible at once. `sequenceRef` is now keyed by
 * item key -> axis (see `axisOf`) so the trio (mutually exclusive with itself, still correctly
 * guarded) and acknowledgedAdvisories (independent) each get their own counter.
 */

/**
 * Groups a patch's field into which of the two independent decision axes it belongs to
 * (design.md section 5) -- the version trio (skippedVersion/remindAt/approvedVersion) is one
 * axis, mutually exclusive with itself; acknowledgedAdvisories is the other, untouched by a
 * trio write and vice versa. Used to scope the sequence guard in `apply()` below so two calls
 * on DIFFERENT axes never mark each other superseded, while two calls on the SAME axis still
 * correctly do.
 *
 * Exhaustive over `DecisionPatch["field"]` (round 4 review note) rather than a `field ===
 * "acknowledgedAdvisories" ? "advisory" : "gap"` ternary -- a ternary's fallthrough default
 * would silently classify any FUTURE field as "gap" with no compile error, which is exactly
 * the silent-miscategorization failure mode round 3's bug already was. The `never` branch
 * makes adding a field to `DecisionPatch` without updating this function a type error instead.
 */
function axisOf(field: DecisionPatch["field"]): "gap" | "advisory" {
  switch (field) {
    case "skippedVersion":
    case "remindAt":
    case "approvedVersion":
      return "gap"
    case "acknowledgedAdvisories":
      return "advisory"
    default: {
      const exhaustive: never = field
      throw new Error(`axisOf: unhandled DecisionPatch field: ${JSON.stringify(exhaustive)}`)
    }
  }
}

export interface DecisionActionState {
  /** `items`, with any locally-applied (optimistic or confirmed) decision override merged in. */
  items: ReportItem[]
  /** The most recent error for this key, if its last action failed (cleared on the next
   * attempt for that key). */
  errorFor: (key: string) => string | undefined
  apply: (key: string, patch: DecisionPatch) => Promise<void>
}

/**
 * Mirrors decisions.ts's own real merge rule exactly (design.md section 5): the version trio
 * (skippedVersion/remindAt/approvedVersion) is mutually exclusive, so writing any one of them
 * resets the other two -- it does NOT layer onto whatever the trio previously held.
 * acknowledgedAdvisories is a separate, untouched axis on a trio write and vice versa. `current`
 * is the item's existing decision as the UI currently shows it (confirmed or already-optimistic)
 * -- passing null here (as this function used to do unconditionally) is what caused round 2's
 * flicker bug: it discarded the OTHER axis's already-confirmed value for the optimistic preview.
 */
function optimisticDecision(
  patch: DecisionPatch,
  current: ItemDecision | null,
  pinned: string | null,
): ItemDecision {
  const now = new Date().toISOString()
  const isTrioField =
    patch.field === "skippedVersion" ||
    patch.field === "remindAt" ||
    patch.field === "approvedVersion"
  const versionTrio = isTrioField
    ? {
        skippedVersion: patch.field === "skippedVersion" ? patch.value : null,
        remindAt: patch.field === "remindAt" ? patch.value : null,
        approvedVersion: patch.field === "approvedVersion" ? patch.value : null,
        // Captured fresh from the item's own current `pinned`, same as decisions.ts's
        // `item?.pinned ?? null` -- never carried over from a prior approval.
        approvedFromPinned: patch.field === "approvedVersion" ? pinned : null,
      }
    : {
        skippedVersion: current?.skippedVersion ?? null,
        remindAt: current?.remindAt ?? null,
        approvedVersion: current?.approvedVersion ?? null,
        approvedFromPinned: current?.approvedFromPinned ?? null,
      }
  const acknowledgedAdvisories =
    patch.field === "acknowledgedAdvisories"
      ? patch.value
      : (current?.acknowledgedAdvisories ?? null)

  return {
    ...versionTrio,
    acknowledgedAdvisories,
    updatedAt: now,
    // Real identity is server-resolved (the Access JWT / dev identity) -- unknown until the
    // PUT actually resolves; the confirmed decision that replaces this one carries the real
    // value.
    updatedBy: null,
  }
}

export function useOptimisticDecisions(
  items: ReportItem[],
  /** Identifies which fetch `items` came from (e.g. the snapshot id) -- a primitive, not the
   * `items` array itself: resetting on array *reference* would also fire on every render
   * where a caller re-derives (filters/maps) the array without memoizing it, since a fresh
   * array reference is indistinguishable from a genuinely new fetch. A primitive key sidesteps
   * that caller obligation entirely. */
  resetKey: string | number,
  fetchImpl: typeof fetch = fetch,
): DecisionActionState {
  const [overrides, setOverrides] = useState<Map<string, ItemDecision | null>>(new Map())
  const [errors, setErrors] = useState<Map<string, string>>(new Map())
  // Nested (not a `${key}:${axis}` string concatenation) so a real item key already containing
  // ":" or "|" (source lines are "path:22", full keys are "repo|kind|name|source") can never
  // collide with the separator -- see `apply()`'s own doc for why this needs to be per-axis
  // at all, not just per-key.
  const sequenceRef = useRef<Map<string, Map<"gap" | "advisory", number>>>(new Map())

  // A freshly (re)loaded item set (a new snapshot fetch) invalidates any in-flight session's
  // local overrides -- they're about a previous fetch's items, not this one. Biome's own
  // suggested "fix" for the ignore below (drop resetKey to []) would make this never reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey (this function's own param, see its doc) is deliberately the only dependency, not items' array identity.
  useEffect(() => {
    setOverrides(new Map())
    setErrors(new Map())
  }, [resetKey])

  const effectiveItems = useMemo(
    () =>
      items.map((item) =>
        overrides.has(item.key) ? { ...item, decision: overrides.get(item.key) ?? null } : item,
      ),
    [items, overrides],
  )

  async function apply(key: string, patch: DecisionPatch): Promise<void> {
    const axis = axisOf(patch.field)
    const keyAxisSequences = sequenceRef.current.get(key) ?? new Map()
    sequenceRef.current.set(key, keyAxisSequences)
    const mySequence = (keyAxisSequences.get(axis) ?? 0) + 1
    keyAxisSequences.set(axis, mySequence)
    const isCurrent = () => sequenceRef.current.get(key)?.get(axis) === mySequence

    // `effectiveItems` already carries whatever this key's current decision is -- confirmed
    // from `items`, or a still-in-flight optimistic value from a previous `apply()` call on the
    // OTHER axis -- so this is the same value the UI has on screen right now. `hadOverride`
    // records whether that came from an override entry at all, so a failed PUT can put back
    // exactly what was there rather than deleting the key outright (see the catch block).
    const currentItem = effectiveItems.find((i) => i.key === key)
    const current = currentItem?.decision ?? null
    const hadOverride = overrides.has(key)
    const optimistic = optimisticDecision(patch, current, currentItem?.pinned ?? null)
    setOverrides((prev) => new Map(prev).set(key, optimistic))
    setErrors((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    try {
      const confirmed = await putDecision(key, patch, fetchImpl)
      if (isCurrent()) {
        setOverrides((prev) => new Map(prev).set(key, confirmed))
      }
    } catch (err) {
      if (isCurrent()) {
        // Roll back to exactly the pre-action state -- `next.delete(key)` unconditionally (the
        // old behaviour) is only correct when there was no override yet. When another axis's
        // action had already confirmed into an override before this one started, deleting the
        // key would revert to stale `items` and silently drop that confirmed axis from the
        // local view too, not just undo this failed action.
        setOverrides((prev) => {
          const next = new Map(prev)
          if (hadOverride) {
            next.set(key, current)
          } else {
            next.delete(key)
          }
          return next
        })
        setErrors((prev) =>
          new Map(prev).set(key, err instanceof Error ? err.message : String(err)),
        )
      }
    }
  }

  return {
    items: effectiveItems,
    errorFor: (key) => errors.get(key),
    apply,
  }
}
