import { Badge, Card, DataTable, type DataTableColumn } from "@rackbops/ui-react"
import { type ReactNode, useMemo, useState } from "react"
import { AdvisoryList } from "../AdvisoryList.js"
import {
  type DecisionPatch,
  fetchLatestSnapshotItems,
  fetchRepos,
  type ReportItem,
  type RepoSummary,
} from "../api.js"
import { advisoryVariant, gapVariant } from "../badgeVariants.js"
import { DecisionActions } from "../DecisionActions.js"
import { gapPriority } from "../gapPriority.js"
import { applyItemFilters, type ItemFilterState, ItemFilters } from "../ItemFilters.js"
import { sourceUrl } from "../sourceLink.js"
import { useAsync } from "../useAsync.js"
import { useOptimisticDecisions } from "../useOptimisticDecisions.js"

/**
 * Design.md section 6, section 2 ("Per repo"): one table per repo, grouped by role, columns
 * `kind · name · pinned · latest/latestInMajor · gap · advisories · source`; a floating-major
 * pin shows `latestInMajor` and `latest` side by side. The soundness-line summary (K4-7/K4-4,
 * unchanged) stays as each repo's card header; the full per-item table is new here (K4-8a).
 *
 * K4-8a review round 1 (HIGH): "floating-major" here means Tooling's `pinStyle: "major"`
 * (software_inventory.py's `derive_pin_style`: a `^`-prefixed npm dep, a single-numeric-
 * component Docker tag like `node:22`, a bare `vN` GitHub Action tag -- pinned to a major
 * line, floating within it), NOT its `"floating"` enum value (reserved for genuinely
 * unbounded pins -- branch names, `latest` tags, open `>=` ranges -- which never carry a
 * `latestInMajor` at all). The original code checked `pinStyle === "floating"`, so the
 * dual-version display never fired for any real major-pinned item -- 36.5% of a real 802-item
 * snapshot by live count, confirmed against `research/software-inventory-and-update-
 * surfacing.md`'s own "on 2, latest 3.x exists" framing, which is about major-line pins.
 */

const ROLE_ORDER = ["runtime", "infra", "ci", "build", "test"]

function pinnedCell(item: ReportItem): ReactNode {
  const showBothVersions =
    item.pinStyle === "major" && item.latestInMajor !== null && item.latestInMajor !== item.latest
  // kenzen#64 round 2, live-reproduced: `pinned` isn't always a short version -- one real item
  // carries a 164-char assumption note, which under plain nowrap blew this column out and
  // overflowed the whole table. Ellipsize like Source; `title` keeps the full text.
  if (!showBothVersions) {
    const text = `${item.pinned ?? "?"} → ${item.latest ?? "?"}`
    return (
      <span className="kz-ellipsis" title={text}>
        {text}
      </span>
    )
  }
  const text = `${item.pinned ?? "?"} → ${item.latestInMajor} (latest: ${item.latest ?? "?"})`
  return (
    <span className="kz-ellipsis" title={text}>
      {item.pinned ?? "?"} → {item.latestInMajor}{" "}
      <span className="rb-muted">(latest: {item.latest ?? "?"})</span>
    </span>
  )
}

function columns(
  now: string,
  onApply: (key: string, patch: DecisionPatch) => void,
  errorFor: (key: string) => string | undefined,
): DataTableColumn<ReportItem>[] {
  return [
    {
      key: "kind",
      header: "Kind",
      render: (i) => <span className="kz-nowrap">{i.kind}</span>,
      sortValue: (i) => i.kind,
    },
    {
      key: "name",
      header: "Name",
      render: (i) => (
        <span className="kz-nowrap" title={i.name}>
          {i.name}
        </span>
      ),
      sortValue: (i) => i.name,
    },
    { key: "pinned", header: "Pinned → latest", render: pinnedCell },
    {
      key: "gap",
      header: "Gap",
      render: (i) => (
        <span className="kz-nowrap">
          {i.gap && i.gap !== "none" ? <Badge variant={gapVariant(i.gap)}>{i.gap}</Badge> : i.gap}
        </span>
      ),
      sortValue: (i) => gapPriority(i.gap),
    },
    {
      key: "advisories",
      header: "Advisories",
      render: (i) =>
        i.advisoryStatus && i.advisoryStatus !== "none" ? (
          <span className="kz-advisories-cell">
            <Badge variant={advisoryVariant(i.advisoryStatus)}>
              {i.advisoryStatus === "affected"
                ? `${i.advisories.length} affected`
                : i.advisoryStatus}
            </Badge>{" "}
            <AdvisoryList advisories={i.advisories} />
          </span>
        ) : null,
    },
    {
      key: "source",
      header: "Source",
      render: (i) => {
        const url = i.source ? sourceUrl(i.repo, i.source) : null
        return (
          <span className="kz-ellipsis" title={i.source ?? undefined}>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {i.source}
              </a>
            ) : (
              (i.source ?? "?")
            )}
          </span>
        )
      },
    },
    {
      key: "actions",
      header: "Actions",
      // Unlike NeedsDecision.tsx (which already only ever holds rows that need one), Repos
      // shows every item, decided or not, sound or not (design.md section 6.2). No gate here
      // -- always render DecisionActions and trust its own per-axis logic to return null for a
      // fully-sound, never-decided item. Round 1 review, HIGH: an earlier version duplicated
      // that same "anything to show" question out here as `item.decision !== null ||
      // needsDecision(...)`, which was ALSO wrong (see needsDecision.js's own history) -- two
      // places independently deciding the same thing is exactly how they drifted apart before.
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

/**
 * Two independent fetches, not one combined `Promise.all` (K4-8a review round 1, MEDIUM,
 * live-reproduced): `Promise.all` rejects wholesale the instant either call rejects, so a
 * transient failure of just one endpoint discarded the other's already-succeeded data and
 * blanked the whole page. Each fetch now degrades independently.
 *
 * The two calls are unsynchronized -- no shared snapshot id -- so a repo's soundness-line
 * counts (from /api/repos, computed live off "the latest snapshot" at request time) and its
 * item table below (from this snapshot's items) could in principle reflect two different
 * snapshots if an ingest lands in the gap between them (K4-8a review round 1, LOW, declined:
 * fixing this needs a server-side snapshot-pinning query param, real scope beyond this child,
 * against a window measured in milliseconds versus an ingest cadence measured in
 * hours/days -- self-corrects on the next render regardless).
 */
export function Repos() {
  const reposState = useAsync(() => fetchRepos(), [])
  const itemsState = useAsync(() => fetchLatestSnapshotItems(), [])
  const [filters, setFilters] = useState<ItemFilterState>({})

  if (reposState.status === "loading" || itemsState.status === "loading") {
    return <p>Loading repos…</p>
  }
  // repos is the backbone of this page (the list itself, the soundness lines) -- nothing
  // meaningful renders without it, so its own failure stays a full-page error. items is
  // additive detail on top of an already-rendered repo list -- its failure degrades to an
  // inline alert alongside the repo list repos still gives us, not a blanked page.
  if (reposState.status === "error") {
    return <p role="alert">Could not load repos: {reposState.error.message}</p>
  }
  const snapshotItems = itemsState.status === "ready" ? itemsState.data : null
  return (
    <div>
      {itemsState.status === "error" && (
        <p role="alert">Could not load item details: {itemsState.error.message}</p>
      )}
      <RepoList
        repos={reposState.data}
        items={snapshotItems?.items ?? []}
        snapshotId={snapshotItems?.snapshot.snapshotId ?? null}
        filters={filters}
        onFiltersChange={setFilters}
      />
    </div>
  )
}

function RepoList({
  repos,
  items,
  snapshotId,
  filters,
  onFiltersChange,
}: {
  repos: RepoSummary[]
  items: ReportItem[]
  /** null when there's no items fetch to key a reset on yet (still loading/errored) --
   * useOptimisticDecisions needs some resetKey regardless, and -1 can never collide with a
   * real (positive, autoincrement) snapshot id. */
  snapshotId: number | null
  filters: ItemFilterState
  onFiltersChange: (next: ItemFilterState) => void
}) {
  const decisions = useOptimisticDecisions(items, snapshotId ?? -1)
  // Not memoized -- cheap, and re-evaluates "is a remindAt due yet" against the real current
  // time on every render rather than freezing it at whenever items last changed.
  const now = new Date().toISOString()
  const tableColumns = useMemo(
    () => columns(now, decisions.apply, decisions.errorFor),
    [now, decisions.apply, decisions.errorFor],
  )

  const itemsByRepo = useMemo(() => {
    const map = new Map<string, ReportItem[]>()
    for (const item of decisions.items) {
      const bucket = map.get(item.repo)
      if (bucket) {
        bucket.push(item)
      } else {
        map.set(item.repo, [item])
      }
    }
    return map
  }, [decisions.items])

  if (repos.length === 0) {
    return <p>No repos ingested yet.</p>
  }
  return (
    <div>
      <ItemFilters
        items={decisions.items}
        value={filters}
        onChange={onFiltersChange}
        dimensions={["kind", "role", "status"]}
      />
      {repos.map((repo) => (
        <RepoCard
          key={repo.repo}
          repo={repo}
          items={applyItemFilters(itemsByRepo.get(repo.repo) ?? [], filters)}
          columns={tableColumns}
        />
      ))}
    </div>
  )
}

function RepoCard({
  repo,
  items,
  columns,
}: {
  repo: RepoSummary
  items: ReportItem[]
  columns: DataTableColumn<ReportItem>[]
}) {
  return (
    <Card>
      <h3>{repo.repo}</h3>
      <p>{repo.soundness}</p>
      <div className="kz-items-table">
        <DataTable
          columns={columns}
          rows={items}
          rowKey={(i) => i.key}
          groupBy={(i) => i.role ?? "unknown"}
          groupOrder={ROLE_ORDER}
          emptyMessage="No items match these filters."
        />
      </div>
    </Card>
  )
}
