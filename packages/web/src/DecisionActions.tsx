import { effectiveAdvisoryStatus, suppressionState } from "@kenzen/contract/suppression"
import { Button } from "@rackbops/ui-react"
import { useState } from "react"
import type { DecisionPatch, ReportItem } from "./api.js"

/**
 * kenzen#12 (K4-9): the four inline decision actions -- skip / remind (presets 7/30/90 days) /
 * approve / acknowledge -- each with a one-line confirm, on sections 1-2 (NeedsDecision.tsx,
 * Repos.tsx). Shared between both since they render the same ReportItem shape.
 *
 * Round 1 review (HIGH, independently found by both reviewers): the original version gated
 * everything on a single `item.decision !== null` check -- the instant ANY decision existed,
 * the whole cell froze to one summary, forever, with no buttons. That broke the resurface
 * loop remind() exists for (a due reminder has `item.decision !== null` AND `needsDecision()
 * === true`, but got only "Snoozed until ..." with nothing to act on), and broke the two
 * decision axes' independence (design.md section 5: gap suppression and advisory
 * acknowledgment are separate axes -- `effectiveAdvisoryStatus` is its own function precisely
 * because it "can't fit suppressionState's single item-level verdict"). A skipped-but-still-
 * affected item showed only the skip summary with no Acknowledge button, and the symmetric
 * case the same way in reverse.
 *
 * Fixed by rendering the two axes independently, each consulting the same suppression
 * functions `needsDecision.ts`/`repos-route.ts` already use, so this component can never
 * disagree with what actually still needs a decision:
 * - Gap axis (skip/remind/approve share one slot -- design.md section 5: setting any one
 *   resets the other two, so at most one is ever set): buttons when `suppressionState` isn't
 *   `"suppressed"` (covers both "never decided" and "resurfaced" -- active or a due remind);
 *   otherwise the summary for whichever field is set.
 * - Advisory axis (acknowledge): the button when `effectiveAdvisoryStatus` is still
 *   `"affected"` (covers "never acknowledged" and "a new, unacknowledged advisory appeared
 *   since"); otherwise a summary if an acknowledgment is on record, nothing if there was never
 *   anything to acknowledge.
 *
 * `now` is a required prop (not computed here) so both pages' single per-render "now" (see
 * their own docs for why it isn't memoized) is what every row's suppression check agrees on.
 *
 * No `pending` prop, still: useOptimisticDecisions' apply() sets the optimistic decision (and
 * so, per the logic above, this component's own next render) synchronously with marking the
 * key pending, batched into one re-render by React -- a "pending, buttons/confirm still shown"
 * state remains unreachable, not just unlikely.
 */

const REMIND_PRESET_DAYS = [7, 30, 90] as const
const GAP_ACTIONABLE = new Set(["major", "minor", "patch"])

function remindAtIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

interface PendingAction {
  patch: DecisionPatch
  label: string
}

export function DecisionActions({
  item,
  now,
  onApply,
  error,
}: {
  item: ReportItem
  now: string
  onApply: (patch: DecisionPatch) => void
  error: string | undefined
}) {
  const [confirming, setConfirming] = useState<PendingAction | null>(null)

  if (confirming) {
    return (
      <span>
        {confirming.label}?{" "}
        <Button
          type="button"
          onClick={() => {
            onApply(confirming.patch)
            setConfirming(null)
          }}
        >
          Yes
        </Button>{" "}
        <Button type="button" onClick={() => setConfirming(null)}>
          No
        </Button>
        {error && <ErrorLine message={error} />}
      </span>
    )
  }

  const gapActionable = item.gap !== null && GAP_ACTIONABLE.has(item.gap)
  const gapVerdict = gapActionable ? suppressionState(item, item.decision, now) : null
  const showGapButtons = gapVerdict !== null && gapVerdict !== "suppressed"
  const showGapSummary = gapVerdict === "suppressed" && item.decision !== null

  const advisoryStatus = effectiveAdvisoryStatus(item, item.decision)
  const showAcknowledgeButton = advisoryStatus === "affected"
  const showAdvisorySummary =
    advisoryStatus !== "affected" && item.decision?.acknowledgedAdvisories != null

  if (!showGapButtons && !showGapSummary && !showAcknowledgeButton && !showAdvisorySummary) {
    return null
  }

  const canSkipOrApprove = item.latest !== null

  return (
    <span>
      {(showGapButtons || showAcknowledgeButton) && (
        <span>
          {showGapButtons && (
            // kenzen#64: native <details> instead of a hand-rolled dropdown -- keyboard-operable
            // (Enter/Space toggles the summary, native focus order) and closes for free the
            // instant an option's onClick flips `confirming`, since that swaps this whole branch
            // out for the confirm bar and the <details> unmounts with it.
            <details className="kz-menu">
              <summary className="rb-btn rb-btn--sm kz-menu__summary">Skip ▾</summary>
              <div className="kz-menu__panel">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={!canSkipOrApprove}
                  onClick={() =>
                    setConfirming({
                      patch: { field: "skippedVersion", value: item.latest as string },
                      label: `Skip ${item.latest}`,
                    })
                  }
                >
                  Skip {item.latest ?? "?"}
                </Button>
                {REMIND_PRESET_DAYS.map((days) => (
                  <Button
                    key={days}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setConfirming({
                        patch: { field: "remindAt", value: remindAtIn(days) },
                        label: `Remind in ${days} days`,
                      })
                    }
                  >
                    Remind in {days} days
                  </Button>
                ))}
              </div>
            </details>
          )}
          {showGapButtons && (
            <Button
              type="button"
              size="sm"
              disabled={!canSkipOrApprove}
              onClick={() =>
                setConfirming({
                  patch: { field: "approvedVersion", value: item.latest as string },
                  label: `Approve ${item.latest}`,
                })
              }
            >
              Approve
            </Button>
          )}
          {showAcknowledgeButton && (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                setConfirming({
                  patch: {
                    field: "acknowledgedAdvisories",
                    value: item.advisories.map((a) => a.id),
                  },
                  label: `Acknowledge ${item.advisories.length} advisor${item.advisories.length === 1 ? "y" : "ies"}`,
                })
              }
            >
              Acknowledge
            </Button>
          )}
        </span>
      )}
      {showGapSummary && item.decision && (
        <div>
          <GapSummary decision={item.decision} />
        </div>
      )}
      {showAdvisorySummary && item.decision && (
        <div>
          <AdvisorySummary decision={item.decision} />
        </div>
      )}
      {error && (
        <div>
          <ErrorLine message={error} />
        </div>
      )}
    </span>
  )
}

function ErrorLine({ message }: { message: string }) {
  return (
    <span role="alert" className="rb-muted">
      {" "}
      Failed: {message}
    </span>
  )
}

function GapSummary({ decision }: { decision: NonNullable<ReportItem["decision"]> }) {
  // Round 3 review, HIGH, live-reproduced: strict `!== null` read "Skipped undefined" after a
  // real Approve or Remind. GET /api/decisions' decisionJson (decisions-route.ts) deliberately
  // OMITS an unset field rather than sending it as explicit null (unlike toReportItem's shape,
  // which api.ts's own ItemDecision doc already warns about: "always check `!= null`, never
  // rely on `in`/`hasOwnProperty`"). useOptimisticDecisions.ts stores that PUT response
  // straight into `overrides`, so the confirmed decision it renders here can have `undefined`
  // (a missing key) on the fields the action didn't set -- and `undefined !== null` is `true`,
  // so the skippedVersion branch always won regardless of which field was actually set. Loose
  // `!=` treats missing and explicit-null the same, matching every other reader of this type.
  const what =
    decision.skippedVersion != null
      ? `Skipped ${decision.skippedVersion}`
      : decision.remindAt != null
        ? `Snoozed until ${decision.remindAt}`
        : decision.approvedVersion != null
          ? `Approved ${decision.approvedVersion}`
          : "Decided"
  return (
    <span className="rb-muted">
      {what}
      {decision.updatedBy ? ` by ${decision.updatedBy}` : ""}
    </span>
  )
}

function AdvisorySummary({ decision }: { decision: NonNullable<ReportItem["decision"]> }) {
  const count = decision.acknowledgedAdvisories?.length ?? 0
  return (
    <span className="rb-muted">
      Acknowledged {count} advisor{count === 1 ? "y" : "ies"}
      {decision.updatedBy ? ` by ${decision.updatedBy}` : ""}
    </span>
  )
}
