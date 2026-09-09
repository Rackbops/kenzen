import { Badge, Card, DataTable, type DataTableColumn } from "@rackbops/ui-react"
import { useMemo, useState } from "react"
import { AdvisoryList } from "../AdvisoryList.js"
import { type DecisionPatch, fetchLatestSnapshotItems, type ReportItem } from "../api.js"
import { advisoryVariant, gapShieldVariant, gapVariant } from "../badgeVariants.js"
import { StatusShield } from "../brand/StatusShield.js"
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
    {
      key: "repo",
      header: "Repo",
      render: (i) => (
        <span className="kz-nowrap" title={i.repo}>
          {i.repo}
        </span>
      ),
      sortValue: (i) => i.repo,
    },
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
    {
      key: "pinned",
      header: "Pinned → latest",
      render: (i) => {
        // kenzen#64 round 2, live-reproduced: `pinned` isn't always a short version -- one real
        // item carries a 164-char assumption note, which under plain nowrap blew this column to
        // 924px and overflowed the whole table. Ellipsize like Source; `title` keeps the full text.
        const text = `${i.pinned ?? "?"} → ${i.latest ?? "?"}`
        return (
          <span className="kz-ellipsis" title={text}>
            {text}
          </span>
        )
      },
    },
    {
      key: "gap",
      header: "Gap",
      render: (i) => {
        const shieldVariant = gapShieldVariant(i.gap)
        return (
          <span className="kz-nowrap">
            {i.gap ? (
              <span className="kz-status-badge">
                {shieldVariant ? <StatusShield variant={shieldVariant} /> : null}
                <Badge variant={gapVariant(i.gap)}>{i.gap}</Badge>
              </span>
            ) : null}
          </span>
        )
      },
      sortValue: (i) => decisionPriority(i),
    },
    {
      key: "advisoryStatus",
      header: "Advisories",
      render: (i) =>
        i.advisoryStatus === "affected" ? (
          <span className="kz-advisories-cell">
            <span className="kz-status-badge">
              {/* Always "vulnerable" on this branch (advisoryStatus === "affected" is the
                  condition above) -- advisoryShieldVariant is for Repos.tsx's wider column,
                  which also shows historical-only/unknown rows this one never reaches. */}
              <StatusShield variant="vulnerable" />
              <Badge variant={advisoryVariant(i.advisoryStatus)}>
                {i.advisories.length} affected
              </Badge>
            </span>{" "}
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
    return (
      <div className="kz-empty-state">
        {/* kenzen#96: large kanji heading above the banner -- decorative here (the caption
            below already says the same thing in English): aria-hidden rather than a second
            aria-label repeating the header's "kenzen-sei". */}
        <span lang="ja" className="kz-kanji kz-kanji--heading" aria-hidden="true">
          健全性
        </span>
        {/* kenzen#92: the koi banner, real artwork (brand/derive.py), fixed colour -- the one
            brand asset that never recolours with the theme (brand/README.md). Decorative:
            the caption right below says the same thing in words. */}
        <img src="/brand/koi-banner.webp" alt="" className="kz-empty-state__banner" />
        <p>The stream is clean.</p>
      </div>
    )
  }
  return (
    <Card>
      <ItemFilters
        items={candidates}
        value={filters}
        onChange={setFilters}
        dimensions={["repo", "kind", "role", "status"]}
      />
      <div className="kz-items-table kz-items-table--repo">
        <DataTable
          columns={tableColumns}
          rows={filtered}
          rowKey={(i) => i.key}
          defaultSortKey="gap"
          emptyMessage="No items match these filters."
        />
      </div>
    </Card>
  )
}
