import { Button } from "@rackbops/ui-react"
import { useCallback, useState } from "react"
import { clearDecision, type DecisionRecord, fetchDecisions } from "../api.js"
import { DataTable, type DataTableColumn } from "../components/DataTable.js"
import { Tabstrip } from "../components/Tabstrip.js"
import { useAsync } from "../useAsync.js"

/**
 * Design.md section 6, section 3 ("Decided"): skipped, snoozed, approved-pending, with the
 * decision and who/when, plus a *clear* action. Replaces K4-7's fixture-shaped shell with the
 * real `GET /api/decisions` data (K4-8b).
 *
 * Scope boundary with K4-9 (kenzen#12, in flight in this same package): #12 owns the decision
 * actions on sections 1-2 (skip/remind/approve/acknowledge, with confirm + optimistic update).
 * *Clear* here is this issue's own scope line ("the decided table with who/when and *clear*"),
 * and it is the only write this route makes.
 */

/** The four states design.md section 5 gives a decision, in the order the strip shows them. */
type DecisionState = "skipped" | "snoozed" | "approved" | "acknowledged"

const STATE_LABELS: Record<DecisionState, string> = {
  skipped: "Skipped",
  snoozed: "Snoozed",
  approved: "Approved -- PR pending",
  acknowledged: "Advisories acknowledged",
}

const STATE_ORDER: DecisionState[] = ["skipped", "snoozed", "approved", "acknowledged"]

/**
 * A decision's state. Deliberately NOT mutually exclusive at the data layer -- the API lets one
 * row carry several fields at once (a skip AND an acknowledgement) -- so a row appears under
 * every state it actually holds rather than being forced into one bucket and disappearing from
 * the others.
 */
export function decisionStates(d: DecisionRecord): DecisionState[] {
  const states: DecisionState[] = []
  if (d.skippedVersion !== undefined) states.push("skipped")
  if (d.remindAt !== undefined) states.push("snoozed")
  if (d.approvedVersion !== undefined) states.push("approved")
  // Presence of the field, not a non-empty list. `PUT {"acknowledgedAdvisories": []}` is
  // accepted by the server (decisions-route.ts validates "array of strings", which [] satisfies)
  // and stores a real row. Requiring a non-empty list left such a row in NO bucket: invisible in
  // every tab, counted in no badge, yet still non-empty in `decisions`, so the page showed
  // neither it nor the "no decisions" copy -- a row on the server with no way to clear it from
  // the UI. Review round 1, LOW. It renders with an explicit "(none listed)" detail.
  if (d.acknowledgedAdvisories !== undefined) states.push("acknowledged")
  return states
}

/** What the decision says, in one cell, for the state being shown. */
export function decisionDetail(d: DecisionRecord, state: DecisionState): string {
  switch (state) {
    case "skipped":
      return `until newer than ${d.skippedVersion}`
    case "snoozed":
      return `until ${d.remindAt}`
    case "approved":
      return `approved ${d.approvedVersion}`
    case "acknowledged":
      return d.acknowledgedAdvisories?.length
        ? d.acknowledgedAdvisories.join(", ")
        : "(none listed)"
  }
}

export function Decided() {
  // Bumping this re-runs the fetch after a successful clear, so the table reflects the server
  // rather than a locally-mutated copy -- this route has one writer and no need for the
  // optimistic-update machinery K4-9 brings to sections 1-2.
  const [reloadToken, setReloadToken] = useState(0)
  const state = useAsync(() => fetchDecisions(), [reloadToken])
  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  if (state.status === "loading") {
    return <p>Loading decisions…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load decisions: {state.error.message}</p>
  }
  return <DecidedTables decisions={state.data} onCleared={reload} />
}

function DecidedTables({
  decisions,
  onCleared,
}: {
  decisions: DecisionRecord[]
  onCleared: () => void
}) {
  const [selected, setSelected] = useState<DecisionState>("skipped")
  // A SET of in-flight keys, not one scalar: with a scalar, starting a second clear overwrote
  // the first's marker, so the first row re-enabled its button while its request was still
  // outstanding (inviting a duplicate) and whichever request finished first cleared the pending
  // indicator for the other. Review round 1, MEDIUM.
  const [clearing, setClearing] = useState<ReadonlySet<string>>(new Set())
  const [clearError, setClearError] = useState<string | null>(null)

  const byState = new Map<DecisionState, DecisionRecord[]>(STATE_ORDER.map((s) => [s, []]))
  for (const d of decisions) {
    for (const s of decisionStates(d)) {
      byState.get(s)?.push(d)
    }
  }

  if (decisions.length === 0) {
    return <p>No decisions recorded yet.</p>
  }

  async function onClear(d: DecisionRecord) {
    setClearing((current) => new Set(current).add(d.key))
    setClearError(null)
    try {
      await clearDecision(d.key)
      onCleared()
    } catch (error) {
      setClearError(error instanceof Error ? error.message : String(error))
    } finally {
      setClearing((current) => {
        const next = new Set(current)
        next.delete(d.key)
        return next
      })
    }
  }

  const rows = byState.get(selected) ?? []
  const columns: DataTableColumn<DecisionRecord>[] = [
    {
      key: "repo",
      header: "Repo",
      render: (d) => d.repo,
      sortValue: (d) => d.repo,
    },
    {
      key: "name",
      header: "Name",
      render: (d) => (d.kind ? `${d.name} (${d.kind})` : d.name),
      sortValue: (d) => d.name,
    },
    {
      key: "detail",
      header: STATE_LABELS[selected],
      render: (d) => decisionDetail(d, selected),
    },
    {
      key: "who",
      header: "Decided by",
      // updatedBy is nullable on the API (a decision written before an identity was resolvable).
      render: (d) => d.updatedBy ?? "unknown",
      sortValue: (d) => d.updatedBy ?? "",
    },
    {
      key: "when",
      header: "When",
      render: (d) => d.updatedAt,
      sortValue: (d) => d.updatedAt,
    },
    {
      key: "clear",
      header: "",
      render: (d) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={clearing.has(d.key)}
          onClick={() => void onClear(d)}
        >
          {clearing.has(d.key) ? "Clearing…" : "Clear"}
        </Button>
      ),
    },
  ]

  return (
    <div>
      <Tabstrip
        label="Decision state"
        selected={selected}
        onSelect={(id) => setSelected(id as DecisionState)}
        tabs={STATE_ORDER.map((s) => ({
          id: s,
          label: STATE_LABELS[s],
          badge: (byState.get(s) ?? []).length,
        }))}
      />
      {clearError && <p role="alert">Could not clear the decision: {clearError}</p>}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(d) => d.key}
        defaultSortKey="repo"
        emptyMessage={`No ${STATE_LABELS[selected].toLowerCase()} decisions.`}
      />
    </div>
  )
}
