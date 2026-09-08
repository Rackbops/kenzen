import { Badge, Card } from "@rackbops/ui-react"
import { type ReactNode, useMemo, useState } from "react"
import { fetchLatestSnapshotItems, fetchRepos, type ReportItem, type RepoSummary } from "../api.js"
import { advisoryVariant, gapVariant } from "../badgeVariants.js"
import { DataTable, type DataTableColumn } from "../components/DataTable.js"
import { applyItemFilters, type ItemFilterState, ItemFilters } from "../ItemFilters.js"
import { sourceUrl } from "../sourceLink.js"
import { useAsync } from "../useAsync.js"

/**
 * Design.md section 6, section 2 ("Per repo"): one table per repo, grouped by role, columns
 * `kind · name · pinned · latest/latestInMajor · gap · advisories · source`; floating-major
 * pins show `latestInMajor` and `latest` side by side. The soundness-line summary (K4-7/K4-4,
 * unchanged) stays as each repo's card header; the full per-item table is new here (K4-8a).
 */

const ROLE_ORDER = ["runtime", "infra", "ci", "build", "test"]

function pinnedCell(item: ReportItem): ReactNode {
  const showBothVersions =
    item.pinStyle === "floating" &&
    item.latestInMajor !== null &&
    item.latestInMajor !== item.latest
  if (!showBothVersions) {
    return `${item.pinned ?? "?"} → ${item.latest ?? "?"}`
  }
  return (
    <>
      {item.pinned ?? "?"} → {item.latestInMajor}{" "}
      <span className="rb-muted">(latest: {item.latest ?? "?"})</span>
    </>
  )
}

const COLUMNS: DataTableColumn<ReportItem>[] = [
  { key: "kind", header: "Kind", render: (i) => i.kind, sortValue: (i) => i.kind },
  { key: "name", header: "Name", render: (i) => i.name, sortValue: (i) => i.name },
  { key: "pinned", header: "Pinned → latest", render: pinnedCell },
  {
    key: "gap",
    header: "Gap",
    render: (i) =>
      i.gap && i.gap !== "none" ? <Badge variant={gapVariant(i.gap)}>{i.gap}</Badge> : i.gap,
    sortValue: (i) => i.gap ?? "",
  },
  {
    key: "advisories",
    header: "Advisories",
    render: (i) =>
      i.advisoryStatus && i.advisoryStatus !== "none" ? (
        <Badge variant={advisoryVariant(i.advisoryStatus)}>
          {i.advisoryStatus === "affected" ? `${i.advisories.length} affected` : i.advisoryStatus}
        </Badge>
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

export function Repos() {
  const state = useAsync(() => Promise.all([fetchRepos(), fetchLatestSnapshotItems()] as const), [])
  const [filters, setFilters] = useState<ItemFilterState>({})

  if (state.status === "loading") {
    return <p>Loading repos…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load repos: {state.error.message}</p>
  }
  const [repos, snapshotItems] = state.data
  return (
    <RepoList
      repos={repos}
      items={snapshotItems?.items ?? []}
      filters={filters}
      onFiltersChange={setFilters}
    />
  )
}

function RepoList({
  repos,
  items,
  filters,
  onFiltersChange,
}: {
  repos: RepoSummary[]
  items: ReportItem[]
  filters: ItemFilterState
  onFiltersChange: (next: ItemFilterState) => void
}) {
  const itemsByRepo = useMemo(() => {
    const map = new Map<string, ReportItem[]>()
    for (const item of items) {
      const bucket = map.get(item.repo)
      if (bucket) {
        bucket.push(item)
      } else {
        map.set(item.repo, [item])
      }
    }
    return map
  }, [items])

  if (repos.length === 0) {
    return <p>No repos ingested yet.</p>
  }
  return (
    <div>
      <ItemFilters
        items={items}
        value={filters}
        onChange={onFiltersChange}
        dimensions={["kind", "role", "status"]}
      />
      {repos.map((repo) => (
        <RepoCard
          key={repo.repo}
          repo={repo}
          items={applyItemFilters(itemsByRepo.get(repo.repo) ?? [], filters)}
        />
      ))}
    </div>
  )
}

function RepoCard({ repo, items }: { repo: RepoSummary; items: ReportItem[] }) {
  return (
    <Card>
      <h3>{repo.repo}</h3>
      <p>{repo.soundness}</p>
      <DataTable
        columns={COLUMNS}
        rows={items}
        rowKey={(i) => i.key}
        groupBy={(i) => i.role ?? "unknown"}
        groupOrder={ROLE_ORDER}
        emptyMessage="No items match these filters."
      />
    </Card>
  )
}
