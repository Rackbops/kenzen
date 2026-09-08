import { render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { ItemHistoryEntry, ReportItem, RepoSummary } from "../api.js"
import * as api from "../api.js"
import { changeLabel, estateSoundness, History } from "./History.js"

function repoSummary(overrides: Partial<RepoSummary>): RepoSummary {
  return {
    repo: "Rackbops/Tooling",
    role: { runtime: 3 },
    gap: { patch: 1 },
    advisoryStatus: { none: 3 },
    dependabotAlerts: "not enabled",
    decided: 0,
    soundness: "3 items · 0 affected · 1 behind (0/0/1) · 0 decided · 0 unknown",
    ...overrides,
  }
}

function item(overrides: Partial<ReportItem>): ReportItem {
  return {
    key: "Rackbops/Tooling|pip-dep|requests|requirements.txt:3",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    name: "requests",
    pinned: "2.31.0",
    pinStyle: "exact",
    role: "runtime",
    source: "requirements.txt:3",
    latest: "2.32.3",
    latestInMajor: "2.32.3",
    gap: "minor",
    advisoryStatus: "none",
    advisories: [],
    assumed: null,
    note: null,
    decision: null,
    ...overrides,
  }
}

function entry(overrides: Partial<ItemHistoryEntry>): ItemHistoryEntry {
  return {
    snapshotId: 1,
    generatedAt: "2026-09-01T00:00:00Z",
    pinned: "2.31.0",
    latest: "2.32.3",
    gap: "minor",
    advisoryStatus: "none",
    ...overrides,
  }
}

// --- the estate soundness line ------------------------------------------------------------
test("the estate line sums the per-repo counts the server computed", () => {
  // Hand computation: items 3+2=5; affected 0+1=1; behind (1 major + 0 minor + 1 patch)=2;
  // decided 0+2=2; unknown 0+1=1.
  const line = estateSoundness([
    repoSummary({ role: { runtime: 3 }, gap: { patch: 1 }, advisoryStatus: { none: 3 } }),
    repoSummary({
      repo: "Rackbops/kenzen",
      role: { runtime: 1, ci: 1 },
      gap: { major: 1, unknown: 1 },
      advisoryStatus: { affected: 1 },
      decided: 2,
    }),
  ])
  expect(line).toBe("5 items · 1 affected · 2 behind (1/0/1) · 2 decided · 1 unknown")
})

test("the estate line sums every gap bucket, minor included", () => {
  // Review round 1: every other fixture here leaves `minor` at 0, so deleting the minor term
  // from estateSoundness left all of them green -- the middle number of "(major/minor/patch)"
  // and its contribution to "behind" were both unguarded.
  const line = estateSoundness([
    repoSummary({ role: { runtime: 6 }, gap: { major: 1, minor: 2, patch: 3 } }),
  ])
  expect(line).toBe("6 items · 0 affected · 6 behind (1/2/3) · 0 decided · 0 unknown")
})

test("the estate line counts items across every role, not just runtime", () => {
  // A role-blind sum would report 1 here and silently under-count every repo with ci/build/test
  // items -- the estate total has to match what the per-repo lines add up to.
  expect(estateSoundness([repoSummary({ role: { runtime: 1, ci: 2, test: 4 } })])).toContain(
    "7 items",
  )
})

test("renders the per-repo soundness line exactly as the server computed it", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  render(<History />)
  // Two matches, not one, and that is the assertion: with a single repo the estate line must
  // come out identical to that repo's own server-computed line. If the client-side estate
  // arithmetic ever drifts from the server's, this drops back to one match and fails.
  await waitFor(() =>
    expect(
      screen.getAllByText("3 items · 0 affected · 1 behind (0/0/1) · 0 decided · 0 unknown"),
    ).toHaveLength(2),
  )
  expect(screen.getByText("Estate")).toBeInTheDocument()
  expect(screen.getByText("Rackbops/Tooling")).toBeInTheDocument()
})

// --- per-item history ---------------------------------------------------------------------
test("changeLabel names the pin move, and never on the first entry", () => {
  const history = [
    entry({ snapshotId: 1, pinned: "2.31.0" }),
    entry({ snapshotId: 2, pinned: "2.32.3" }),
    entry({ snapshotId: 3, pinned: "2.32.3" }),
  ]
  // The first entry has nothing to differ from, so it must not read as a change.
  expect(changeLabel(history, history[0] as ItemHistoryEntry)).toBe("—")
  expect(changeLabel(history, history[1] as ItemHistoryEntry)).toBe("pinned 2.31.0 → 2.32.3")
  expect(changeLabel(history, history[2] as ItemHistoryEntry)).toBe("—")
})

test("two snapshots differing in one pin: the history view shows the change", async () => {
  // The issue's first acceptance bullet, at the component level.
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: {
      snapshotId: 2,
      generatedAt: "2026-09-02T00:00:00Z",
      inventoryItems: 1,
      summary: {},
    },
    items: [item({})],
  })
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchItemHistory").mockResolvedValue([
    entry({ snapshotId: 1, generatedAt: "2026-09-01T00:00:00Z", pinned: "2.31.0" }),
    entry({ snapshotId: 2, generatedAt: "2026-09-02T00:00:00Z", pinned: "2.32.3" }),
  ])

  render(<History />)
  await waitFor(() => expect(screen.getByText("pinned 2.31.0 → 2.32.3")).toBeInTheDocument())
  expect(screen.getByText("2026-09-01T00:00:00Z")).toBeInTheDocument()
  expect(screen.getByText("2026-09-02T00:00:00Z")).toBeInTheDocument()
})

test("the history request uses the item's key", async () => {
  const key = "Rackbops/Tooling|pip-dep|requests|requirements.txt:3"
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: {
      snapshotId: 1,
      generatedAt: "2026-09-01T00:00:00Z",
      inventoryItems: 1,
      summary: {},
    },
    items: [item({ key })],
  })
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  const fetchItemHistory = vi.spyOn(api, "fetchItemHistory").mockResolvedValue([entry({})])

  render(<History />)
  await waitFor(() => expect(fetchItemHistory).toHaveBeenCalledWith(key))
})

test("surfaces a history load failure", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: {
      snapshotId: 1,
      generatedAt: "2026-09-01T00:00:00Z",
      inventoryItems: 1,
      summary: {},
    },
    items: [item({})],
  })
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchItemHistory").mockRejectedValue(new Error("boom"))

  render(<History />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"))
})

test("renders empty-state copy when nothing has been ingested", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  vi.spyOn(api, "fetchRepos").mockResolvedValue([])
  render(<History />)
  await waitFor(() => expect(screen.getByText("No snapshots ingested yet.")).toBeInTheDocument())
  expect(screen.getByText("No repos ingested yet.")).toBeInTheDocument()
})
