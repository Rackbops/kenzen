import { Button } from "@rackbops/ui-react"
import { useState } from "react"
import type { DecisionPatch, ReportItem } from "./api.js"

/**
 * kenzen#12 (K4-9): the four inline decision actions -- skip / remind (presets 7/30/90 days) /
 * approve / acknowledge -- each with a one-line confirm, on sections 1-2 (NeedsDecision.tsx,
 * Repos.tsx). Shared between both since they render the same ReportItem shape.
 *
 * Only offered when the item is both undecided (`decision === null` -- an already-decided
 * item shows a short summary instead, no re-deciding here; a `clear` action belongs to the
 * Decided page, K4-8b) AND has something to act on (a resolvable `latest`, or advisories to
 * acknowledge) -- an item with `gap: "unknown"`/no `latest` can't be skipped or approved
 * against a version that doesn't exist.
 *
 * No `pending` prop: useOptimisticDecisions' apply() sets the optimistic decision and marks
 * the key pending in the same synchronous call, which React 18 batches into one re-render --
 * so by the time a render would ever reflect pending=true for this item, `item.decision` is
 * already non-null and this component has already switched to DecidedSummary below. A
 * "pending" button/confirm-row state is therefore unreachable, not just unlikely; DecidedSummary
 * omits the "by <who>" attribution until the server's real response replaces the optimistic
 * one, which is the only pending signal that can actually show.
 */

const REMIND_PRESET_DAYS = [7, 30, 90] as const

function remindAtIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

interface PendingAction {
  patch: DecisionPatch
  label: string
}

export function DecisionActions({
  item,
  onApply,
  error,
}: {
  item: ReportItem
  onApply: (patch: DecisionPatch) => void
  error: string | undefined
}) {
  const [confirming, setConfirming] = useState<PendingAction | null>(null)

  if (item.decision !== null) {
    return <DecidedSummary decision={item.decision} />
  }

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

  const canSkipOrApprove = item.latest !== null
  const canAcknowledge = item.advisories.length > 0

  return (
    <span>
      <Button
        type="button"
        disabled={!canSkipOrApprove}
        onClick={() =>
          setConfirming({
            patch: { field: "skippedVersion", value: item.latest as string },
            label: `Skip ${item.latest}`,
          })
        }
      >
        Skip
      </Button>{" "}
      {REMIND_PRESET_DAYS.map((days) => (
        <Button
          key={days}
          type="button"
          onClick={() =>
            setConfirming({
              patch: { field: "remindAt", value: remindAtIn(days) },
              label: `Remind in ${days} days`,
            })
          }
        >
          {days}d
        </Button>
      ))}{" "}
      <Button
        type="button"
        disabled={!canSkipOrApprove}
        onClick={() =>
          setConfirming({
            patch: { field: "approvedVersion", value: item.latest as string },
            label: `Approve ${item.latest}`,
          })
        }
      >
        Approve
      </Button>{" "}
      <Button
        type="button"
        disabled={!canAcknowledge}
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
      {error && <ErrorLine message={error} />}
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

function DecidedSummary({ decision }: { decision: NonNullable<ReportItem["decision"]> }) {
  const [what] = [
    decision.skippedVersion !== null
      ? `Skipped ${decision.skippedVersion}`
      : decision.remindAt !== null
        ? `Snoozed until ${decision.remindAt}`
        : decision.approvedVersion !== null
          ? `Approved ${decision.approvedVersion}`
          : decision.acknowledgedAdvisories !== null
            ? `Acknowledged ${decision.acknowledgedAdvisories.length} advisor${decision.acknowledgedAdvisories.length === 1 ? "y" : "ies"}`
            : "Decided",
  ]
  return (
    <span className="rb-muted">
      {what}
      {decision.updatedBy ? ` by ${decision.updatedBy}` : ""}
    </span>
  )
}
