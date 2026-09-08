import { Card, DataTable, type DataTableColumn } from "@rackbops/ui-react"
import { useState } from "react"
import {
  fetchItemHistory,
  fetchLatestSnapshotItems,
  fetchRepoSoundnessSeries,
  fetchRepos,
  fetchSnapshots,
  type ItemHistoryEntry,
  type ReportItem,
  type RepoSoundnessPoint,
  type RepoSummary,
  type Soundness,
} from "../api.js"
import { Sparkline } from "../components/Sparkline.js"
import { useAsync } from "../useAsync.js"

/**
 * Design.md section 6, section 5 ("History"): for any item, its pins and gaps across snapshots;
 * and the soundness line (section 6), and now its trend over time (kenzen#38), per repo and for
 * the estate. Replaces K4-7's fixture-shaped shell with the real `GET /api/items/:key/history`
 * and `GET /api/repos` data (K4-8b).
 *
 * The CURRENT soundness line is rendered from `/api/repos`, which computes it server-side over
 * the LATEST snapshot including the K4-5 "decided" suppression semantics -- this route formats
 * it, it does not recompute it, so the page and the API can never disagree about the counts.
 * The TREND sparkline underneath (kenzen#38) is the same story one level up: `/api/snapshots`
 * and `/api/repos/:repo/soundness` compute a typed `Soundness` per snapshot server-side (reusing
 * the exact same suppression-aware arithmetic `/api/repos` already used, `soundness.ts` on the
 * server), and this route only plots it -- see `Soundness` below for which field.
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
      <SoundnessSection repos={repos} />
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

// A sparkline plots one scalar per snapshot; "behind" (major+minor+patch, an outdated pin) is
// the single most representative day-to-day trend number for this dashboard, distinct from
// "affected" (security-specific, rarer, spikier) -- the full breakdown stays visible in the
// text line right above the sparkline, this is only the at-a-glance shape of its change.
function behindTotal(s: Soundness): number {
  return s.behind.major + s.behind.minor + s.behind.patch
}

function trendLabel(values: number[]): string {
  const first = values[0] ?? 0
  const last = values[values.length - 1] ?? 0
  return `${values.length} snapshots, ${first} to ${last} behind`
}

const SERIES_LIMIT = 30

interface SoundnessSeries {
  /** Oldest first. */
  estate: number[]
  /** Oldest first; absent key means that repo's series fetch is not in yet or came back empty. */
  byRepo: Map<string, number[]>
}

/** `fetchSnapshots` returns newest-first (its own established order, matching
 * `fetchLatestSnapshot`'s use of index 0); a trend line reads left-to-right chronologically, so
 * only the estate series needs reversing here -- `fetchRepoSoundnessSeries` already comes back
 * oldest-first from the server (repos-route.ts's own choice, matching item-history-route.ts's
 * convention for a series-shaped response).
 *
 * `Promise.allSettled`, not `Promise.all` (kenzen#38 review round 1, MEDIUM): the estate fetch
 * and every repo's own fetch are independent rendering targets (each Card draws its own
 * sparkline), so one repo's transient failure -- or the estate fetch's -- must not blank every
 * OTHER sparkline that already succeeded. A rejected entry degrades to an empty series, which
 * `Sparkline` already renders as nothing (its own <2-points case), the same as "not fetched
 * yet" -- there is no separate error UI for this secondary, additive layer, matching the
 * existing choice that a slow/failed series never blocks the section's own (server-computed,
 * independently-sourced) text line above it. */
async function fetchSoundnessSeries(repoNames: string[]): Promise<SoundnessSeries> {
  const [snapshotsResult, ...repoResults] = await Promise.allSettled([
    fetchSnapshots(SERIES_LIMIT),
    ...repoNames.map((name) => fetchRepoSoundnessSeries(name, SERIES_LIMIT)),
  ])
  const estate =
    snapshotsResult.status === "fulfilled"
      ? snapshotsResult.value
          .slice()
          .reverse()
          // A real response always carries `soundness` (see SnapshotSummary's own docstring);
          // the fallback is only for a test fixture built before this field existed.
          .map((s) => (s.soundness ? behindTotal(s.soundness) : 0))
      : []
  const byRepo = new Map(
    repoNames.map((name, i): [string, number[]] => {
      const result = repoResults[i]
      const points = result?.status === "fulfilled" ? result.value : ([] as RepoSoundnessPoint[])
      return [name, points.map((p) => behindTotal(p.soundness))]
    }),
  )
  return { estate, byRepo }
}

/**
 * The current soundness line (server-computed, unchanged since K4-8b) plus its trend sparkline
 * (kenzen#38) for the estate and for each repo. The series fetch is its own `useAsync`,
 * independent of `History()`'s own `[latest, repos]` fetch and keyed on the actual SET of repo
 * names (not the `repos` array reference, which is a new object every render) -- a slow or
 * failed series fetch degrades to no sparkline rather than blanking the whole section, since the
 * text line above it already carries the current, decision-suppressed numbers on its own.
 */
function SoundnessSection({ repos }: { repos: RepoSummary[] }) {
  const repoNames = repos.map((r) => r.repo)
  const seriesKey = repoNames.join("|")
  const seriesState = useAsync(() => fetchSoundnessSeries(repoNames), [seriesKey])

  if (repos.length === 0) {
    return (
      <section>
        <h2>Soundness</h2>
        <p>No repos ingested yet.</p>
      </section>
    )
  }

  const series = seriesState.status === "ready" ? seriesState.data : null
  const repoSeries = (repo: string): number[] => series?.byRepo.get(repo) ?? []

  return (
    <section>
      <h2>Soundness</h2>
      <Card>
        <h3>Estate</h3>
        <p>{estateSoundness(repos)}</p>
        {series && <Sparkline values={series.estate} label={trendLabel(series.estate)} />}
      </Card>
      {repos.map((r) => (
        <Card key={r.repo}>
          <h3>{r.repo}</h3>
          <p>{r.soundness}</p>
          {series && (
            <Sparkline values={repoSeries(r.repo)} label={trendLabel(repoSeries(r.repo))} />
          )}
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
