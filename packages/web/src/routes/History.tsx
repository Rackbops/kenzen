import { Card } from "@rackbops/ui-react"
import { useState } from "react"
import {
  fetchItemHistory,
  fetchLatestSnapshotItems,
  fetchRepos,
  type ItemHistoryEntry,
  type ReportItem,
  type RepoSummary,
} from "../api.js"
import { DataTable, type DataTableColumn } from "../components/DataTable.js"
import { useAsync } from "../useAsync.js"

/**
 * Design.md section 6, section 5 ("History"): for any item, its pins and gaps across snapshots;
 * and the soundness line (section 6) per repo and for the estate. Replaces K4-7's
 * fixture-shaped shell with the real `GET /api/items/:key/history` and `GET /api/repos` data
 * (K4-8b).
 *
 * The soundness line is rendered from `/api/repos`, which computes it server-side over the
 * LATEST snapshot including the K4-5 "decided" suppression semantics -- this route formats it,
 * it does not recompute it, so the page and the API can never disagree about the counts.
 *
 * Design.md also asks for "the soundness line over time"; that is deliberately NOT built here.
 * Nothing exposes per-snapshot soundness: `/api/repos` covers the latest snapshot only, and
 * `/api/snapshots`'s `summary` is `{"type": "object"}` in the vendored contract schema -- an
 * explicitly unspecified shape this UI must not start depending on. Doing it properly needs a
 * server endpoint, which is more than this child's effort-M scope; per-ITEM history over
 * snapshots (the part the acceptance bullets test) is here in full.
 */

export function History() {
  const state = useAsync(() => Promise.all([fetchLatestSnapshotItems(), fetchRepos()]), [])

  if (state.status === "loading") {
    return <p>Loading history…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load history: {state.error.message}</p>
  }
  const [latest, repos] = state.data
  return (
    <div>
      <Soundness repos={repos} />
      <h2>Item history</h2>
      {latest === null ? <p>No snapshots ingested yet.</p> : <ItemHistory items={latest.items} />}
    </div>
  )
}

/** Sums the per-repo counts the server already computed into one estate line, in the same
 * `N items · A affected · G behind (major/minor/patch) · D decided · U unknown` format
 * repos-route.ts emits per repo (design.md section 6). Summing the components rather than
 * parsing each repo's rendered string keeps the two from drifting into different arithmetic. */
export function estateSoundness(repos: RepoSummary[]): string {
  let items = 0
  let affected = 0
  let major = 0
  let minor = 0
  let patch = 0
  let unknown = 0
  let decided = 0
  for (const r of repos) {
    for (const n of Object.values(r.role)) {
      items += n
    }
    affected += r.advisoryStatus.affected ?? 0
    major += r.gap.major ?? 0
    minor += r.gap.minor ?? 0
    patch += r.gap.patch ?? 0
    unknown += r.gap.unknown ?? 0
    decided += r.decided
  }
  const behind = major + minor + patch
  return (
    `${items} items · ${affected} affected · ${behind} behind ` +
    `(${major}/${minor}/${patch}) · ${decided} decided · ${unknown} unknown`
  )
}

function Soundness({ repos }: { repos: RepoSummary[] }) {
  if (repos.length === 0) {
    return (
      <section>
        <h2>Soundness</h2>
        <p>No repos ingested yet.</p>
      </section>
    )
  }
  return (
    <section>
      <h2>Soundness</h2>
      <Card>
        <h3>Estate</h3>
        <p>{estateSoundness(repos)}</p>
      </Card>
      {repos.map((r) => (
        <Card key={r.repo}>
          <h3>{r.repo}</h3>
          <p>{r.soundness}</p>
        </Card>
      ))}
    </section>
  )
}

function ItemHistory({ items }: { items: ReportItem[] }) {
  const [selectedKey, setSelectedKey] = useState<string>(items[0]?.key ?? "")

  if (items.length === 0) {
    return <p>No items in the latest snapshot.</p>
  }

  return (
    <div>
      <label htmlFor="history-item">
        Item{" "}
        <select
          id="history-item"
          value={selectedKey}
          onChange={(e) => setSelectedKey(e.target.value)}
        >
          {items.map((item) => (
            <option key={item.key} value={item.key}>
              {item.repo} · {item.name} ({item.kind})
            </option>
          ))}
        </select>
      </label>
      {selectedKey !== "" && <ItemHistoryTable itemKey={selectedKey} />}
    </div>
  )
}

function ItemHistoryTable({ itemKey }: { itemKey: string }) {
  const state = useAsync(() => fetchItemHistory(itemKey), [itemKey])

  if (state.status === "loading") {
    return <p>Loading item history…</p>
  }
  if (state.status === "error") {
    return <p role="alert">Could not load item history: {state.error.message}</p>
  }

  const columns: DataTableColumn<ItemHistoryEntry>[] = [
    {
      key: "generatedAt",
      header: "Snapshot",
      render: (e) => e.generatedAt,
      sortValue: (e) => e.generatedAt,
    },
    { key: "pinned", header: "Pinned", render: (e) => e.pinned ?? "—" },
    { key: "latest", header: "Latest", render: (e) => e.latest ?? "—" },
    { key: "gap", header: "Gap", render: (e) => e.gap ?? "—" },
    { key: "advisoryStatus", header: "Advisories", render: (e) => e.advisoryStatus ?? "—" },
    {
      key: "changed",
      header: "Changed",
      // What the section is actually for: which snapshot the pin moved in. Computed against the
      // PREVIOUS entry, so the first row is always "—" rather than falsely reading as a change.
      render: (e) => changeLabel(state.data, e),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={state.data}
      rowKey={(e) => String(e.snapshotId)}
      emptyMessage="No history for this item yet."
    />
  )
}

/** "pinned 1.2.3 → 1.3.0" for the entry where the pin moved, "—" otherwise (and always for the
 * first entry, which has nothing to differ from). */
export function changeLabel(history: ItemHistoryEntry[], entry: ItemHistoryEntry): string {
  const index = history.findIndex((e) => e.snapshotId === entry.snapshotId)
  if (index <= 0) {
    return "—"
  }
  const previous = history[index - 1]
  if (!previous || previous.pinned === entry.pinned) {
    return "—"
  }
  return `pinned ${previous.pinned ?? "—"} → ${entry.pinned ?? "—"}`
}
