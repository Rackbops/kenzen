import { Badge, Card } from "@rackbops/ui-react"
import { useMemo, useState } from "react"
import { fetchLatestSnapshotItems, type ReportItem } from "../api.js"
import { advisoryVariant, gapVariant } from "../badgeVariants.js"
import { DataTable, type DataTableColumn } from "../components/DataTable.js"
import { applyItemFilters, type ItemFilterState, ItemFilters } from "../ItemFilters.js"
import { sourceUrl } from "../sourceLink.js"
import { useAsync } from "../useAsync.js"

/**
 * Design.md section 6, section 1 ("Needs a decision"): items with `advisoryStatus = affected`
 * first, then `gap ∈ {major, minor, patch}`, both without a decision on record.
 *
 * "Without a decision" here means `decision === null` -- the raw absence of any decision row,
 * not the suppression-aware "is an existing skip/remind/approve still in effect" question
 * (design.md section 5's decision-effect table). That nuance, and the four inline decision
 * actions themselves, are K4-9's scope ("Decision actions in the page", prerequisite: this
 * child) -- K4-8a renders the table faithfully from what's unambiguous today.
 */

const PRIORITY: Record<string, number> = { major: 1, minor: 2, patch: 3 }

function priority(item: ReportItem): number {
  if (item.advisoryStatus === "affected") return 0
  if (item.gap !== null && item.gap in PRIORITY) return PRIORITY[item.gap] as number
  return 99
}

function needsDecision(item: ReportItem): boolean {
  if (item.decision !== null) return false
  if (item.advisoryStatus === "affected") return true
  return item.gap === "major" || item.gap === "minor" || item.gap === "patch"
}

const COLUMNS: DataTableColumn<ReportItem>[] = [
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
    sortValue: (i) => priority(i),
  },
  {
    key: "advisoryStatus",
    header: "Advisories",
    render: (i) =>
      i.advisoryStatus === "affected" ? (
        <Badge variant={advisoryVariant(i.advisoryStatus)}>{i.advisories.length} affected</Badge>
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
]

export function NeedsDecision() {
  const state = useAsync(() => fetchLatestSnapshotItems(), [])
  const [filters, setFilters] = useState<ItemFilterState>({})

  if (state.status === "loading") {
    return <p>Loading…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load: {state.error.message}</p>
  }
  if (state.data === null) {
    return <p>No data has been ingested yet.</p>
  }
  return (
    <NeedsDecisionTable items={state.data.items} filters={filters} onFiltersChange={setFilters} />
  )
}

function NeedsDecisionTable({
  items,
  filters,
  onFiltersChange,
}: {
  items: ReportItem[]
  filters: ItemFilterState
  onFiltersChange: (next: ItemFilterState) => void
}) {
  const candidates = useMemo(() => items.filter(needsDecision), [items])
  const filtered = useMemo(() => applyItemFilters(candidates, filters), [candidates, filters])

  if (candidates.length === 0) {
    return <p>Nothing needs a decision.</p>
  }
  return (
    <Card>
      <ItemFilters
        items={candidates}
        value={filters}
        onChange={onFiltersChange}
        dimensions={["repo", "kind", "role", "status"]}
      />
      <DataTable
        columns={COLUMNS}
        rows={filtered}
        rowKey={(i) => i.key}
        defaultSortKey="gap"
        emptyMessage="No items match these filters."
        sticky
      />
    </Card>
  )
}
