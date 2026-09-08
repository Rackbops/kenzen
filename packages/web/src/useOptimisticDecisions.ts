import { useEffect, useMemo, useState } from "react"
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
 */

export interface DecisionActionState {
  /** `items`, with any locally-applied (optimistic or confirmed) decision override merged in. */
  items: ReportItem[]
  /** The most recent error for this key, if its last action failed (cleared on the next
   * attempt for that key). */
  errorFor: (key: string) => string | undefined
  apply: (key: string, patch: DecisionPatch) => Promise<void>
}

function optimisticDecision(patch: DecisionPatch): ItemDecision {
  const now = new Date().toISOString()
  const base: ItemDecision = {
    skippedVersion: null,
    remindAt: null,
    approvedVersion: null,
    acknowledgedAdvisories: null,
    updatedAt: now,
    // Real identity is server-resolved (the Access JWT / dev identity) -- unknown until the
    // PUT actually resolves; the confirmed decision that replaces this one carries the real
    // value.
    updatedBy: null,
  }
  return { ...base, [patch.field]: patch.value }
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
    setOverrides((prev) => new Map(prev).set(key, optimisticDecision(patch)))
    setErrors((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    try {
      const confirmed = await putDecision(key, patch, fetchImpl)
      setOverrides((prev) => new Map(prev).set(key, confirmed))
    } catch (err) {
      setOverrides((prev) => {
        const next = new Map(prev)
        next.delete(key)
        return next
      })
      setErrors((prev) => new Map(prev).set(key, err instanceof Error ? err.message : String(err)))
    }
  }

  return {
    items: effectiveItems,
    errorFor: (key) => errors.get(key),
    apply,
  }
}
