import { Badge, Card } from "@rackbops/ui-react"
import { useMemo, useState } from "react"
import { AdvisoryList } from "../AdvisoryList.js"
import { type DecisionPatch, fetchLatestSnapshotItems, type ReportItem } from "../api.js"
import { advisoryVariant, gapVariant } from "../badgeVariants.js"
import { DataTable, type DataTableColumn } from "../components/DataTable.js"
import { DecisionActions } from "../DecisionActions.js"
import { applyItemFilters, type ItemFilterState, ItemFilters } from "../ItemFilters.js"
import { decisionPriority, needsDecision } from "../needsDecision.js"
import { sourceUrl } from "../sourceLink.js"
import { useAsync } from "../useAsync.js"
import { useOptimisticDecisions } from "../useOptimisticDecisions.js"

/**
 * Design.md section 6, section 1 ("Needs a decision"): items with `advisoryStatus = affected`
 * (advisories not acknowledged) first, then `gap ∈ {major, minor, patch}` without a decision
 * still in effect, each row with the four inline decision actions (K4-9). The filter and sort
 * predicates (suppression-aware, per design.md section 5) live in ../needsDecision.js, shared
 * with Repos.tsx -- see that module's own doc for why "without a decision ... in effect" is
 * more than K4-8a's original "is there any decision row at all" placeholder gate.
 */

function columns(
  now: string,
  onApply: (key: string, patch: DecisionPatch) => void,
  errorFor: (key: string) => string | undefined,
): DataTableColumn<ReportItem>[] {
  return [
    { key: "repo", header: "Repo", render: (i) => i.repo, sortValue: (i) => i.repo },
    { key: "kind", header: "Kind", render: (i) => i.kind, sortValue: (i) => i.kind },
    { key: "name", header: "Name", render: (i) => i.name, sortValue: (i) => i.name },
    {
      key: "pinned",
      header: "Pinned → latest",
      render: (i) => `${i.pinned ?? "?"} → ${i.latest ?? "?"}`,
    },
    {
      key: "gap",
      header: "Gap",
      render: (i) => (i.gap ? <Badge variant={gapVariant(i.gap)}>{i.gap}</Badge> : null),
      sortValue: (i) => decisionPriority(i),
    },
    {
      key: "advisoryStatus",
      header: "Advisories",
      render: (i) =>
        i.advisoryStatus === "affected" ? (
          <>
            <Badge variant={advisoryVariant(i.advisoryStatus)}>
              {i.advisories.length} affected
            </Badge>{" "}
            <AdvisoryList advisories={i.advisories} />
          </>
        ) : null,
    },
    {
      key: "source",
      header: "Source",
      render: (i) => {
        const url = i.source ? sourceUrl(i.repo, i.source) : null
        return url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {i.source}
          </a>
        ) : (
          (i.source ?? "?")
        )
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (i) => (
        <DecisionActions
          item={i}
          now={now}
          onApply={(patch) => onApply(i.key, patch)}
          error={errorFor(i.key)}
        />
      ),
    },
  ]
}

export function NeedsDecision() {
  const state = useAsync(() => fetchLatestSnapshotItems(), [])

  if (state.status === "loading") {
    return <p>Loading…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load: {state.error.message}</p>
  }
  if (state.data === null) {
    return <p>No data has been ingested yet.</p>
  }
  return <NeedsDecisionTable items={state.data.items} snapshotId={state.data.snapshot.snapshotId} />
}

function NeedsDecisionTable({ items, snapshotId }: { items: ReportItem[]; snapshotId: number }) {
  const [filters, setFilters] = useState<ItemFilterState>({})
  const decisions = useOptimisticDecisions(items, snapshotId)
  // Computed once per render (not memoized -- cheap, and a long-lived tab should keep
  // re-evaluating "is a remindAt due yet" against the actual current time, not freeze it at
  // whenever items last changed), and once per render only, not per item -- a due `remindAt`
  // shouldn't flip mid-list from one row's evaluation to the next over a genuinely long table.
  const now = new Date().toISOString()

  const candidates = useMemo(
    () => decisions.items.filter((i) => needsDecision(i, now)),
    [decisions.items, now],
  )
  const filtered = useMemo(() => applyItemFilters(candidates, filters), [candidates, filters])
  const tableColumns = useMemo(
    () => columns(now, decisions.apply, decisions.errorFor),
    [now, decisions.apply, decisions.errorFor],
  )

  if (candidates.length === 0) {
    return <p>Nothing needs a decision.</p>
  }
  return (
    <Card>
      <ItemFilters
        items={candidates}
        value={filters}
        onChange={setFilters}
        dimensions={["repo", "kind", "role", "status"]}
      />
      <DataTable
        columns={tableColumns}
        rows={filtered}
        rowKey={(i) => i.key}
        defaultSortKey="gap"
        emptyMessage="No items match these filters."
        sticky
      />
    </Card>
  )
}
