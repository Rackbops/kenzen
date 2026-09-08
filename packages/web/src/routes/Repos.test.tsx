import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { ReportItem, RepoSummary } from "../api.js"
import * as api from "../api.js"
import { Repos } from "./Repos.js"

function repoSummary(overrides: Partial<RepoSummary>): RepoSummary {
  return {
    repo: "Rackbops/Tooling",
    role: { runtime: 3 },
    gap: { patch: 1 },
    advisoryStatus: { none: 3 },
    dependabotAlerts: "not enabled",
    soundness: "3 items · 0 affected · 1 behind (0/0/1) · 0 decided · 0 unknown",
    ...overrides,
  }
}

function item(overrides: Partial<ReportItem>): ReportItem {
  return {
    key: overrides.key ?? "k",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    name: "requests",
    pinned: "2.31.0",
    pinStyle: "exact",
    role: "runtime",
    source: "requirements.txt:3",
    latest: "2.32.3",
    latestInMajor: "2.32.3",
    gap: "none",
    advisoryStatus: "none",
    advisories: [],
    assumed: null,
    note: null,
    decision: null,
    ...overrides,
  }
}

const SNAPSHOT = {
  snapshotId: 1,
  generatedAt: "2026-09-08T00:00:00Z",
  inventoryItems: 1,
  summary: {},
}

test("renders a card per repo with its real soundness line, then its item table", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [item({ key: "a", name: "requests" })],
  })
  render(<Repos />)
  expect(screen.getByText("Loading repos…")).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText("Rackbops/Tooling")).toBeInTheDocument())
  expect(screen.getByText(/3 items · 0 affected/)).toBeInTheDocument()
  expect(screen.getByText("requests")).toBeInTheDocument()
})

test("renders an empty state when there are no repos yet", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("No repos ingested yet.")).toBeInTheDocument())
})

test("renders an error state when the repos fetch fails", async () => {
  vi.spyOn(api, "fetchRepos").mockRejectedValue(new Error("boom"))
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(<Repos />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/))
})

test("an items-fetch failure still shows the repo list, with an inline error for the item detail", async () => {
  // K4-8a review round 1, MEDIUM, live-reproduced: the original single Promise.all discarded
  // repos' already-succeeded data the instant items rejected, blanking the whole page. The
  // repo list/soundness lines are independently useful even without the item-detail tables.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockRejectedValue(new Error("items boom"))
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("Rackbops/Tooling")).toBeInTheDocument())
  expect(screen.getByText(/3 items · 0 affected/)).toBeInTheDocument()
  expect(screen.getByRole("alert")).toHaveTextContent(/items boom/)
})

test("groups a repo's items by role, in the runtime/infra/ci/build/test order", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "t", name: "test-only-pkg", role: "test" }),
      item({ key: "r", name: "runtime-pkg", role: "runtime" }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  const groupLabels = within(screen.getByRole("table"))
    .getAllByText(/^(runtime|test)$/)
    .map((el) => el.textContent)
  expect(groupLabels).toEqual(["runtime", "test"])
})

test("a major-style pin (e.g. a ^-prefixed npm dep) shows latestInMajor with latest annotated alongside", async () => {
  // pinStyle here matches Tooling's real classifier (software_inventory.py's
  // derive_pin_style): a "^"-prefixed npm-dep, a single-numeric-component Docker tag, or a
  // bare vN GitHub Action tag is "major", never "floating" -- K4-8a review round 1, HIGH:
  // the original code checked pinStyle === "floating" here, which real data never sets
  // alongside a non-null latestInMajor at all, so this display never fired for real data.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "f",
        name: "major-pkg",
        pinStyle: "major",
        pinned: "^2.4.0",
        latestInMajor: "2.9.0",
        latest: "3.1.0",
        gap: "major",
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("major-pkg")).toBeInTheDocument())
  const row = screen.getByText("major-pkg").closest("tr")
  expect(row?.textContent).toContain("2.9.0")
  expect(row?.textContent).toContain("latest: 3.1.0")
})

test("a genuinely floating pin (pinStyle floating) never shows the dual-version annotation, even with a latestInMajor", async () => {
  // Real data never sets latestInMajor for a "floating"-style pin, but the display logic
  // should still be exact about which pinStyle it triggers on, defensively.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "fl",
        name: "unbounded-pkg",
        pinStyle: "floating",
        pinned: "latest",
        latestInMajor: "2.9.0",
        latest: "3.1.0",
        gap: "unknown",
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("unbounded-pkg")).toBeInTheDocument())
  const row = screen.getByText("unbounded-pkg").closest("tr")
  expect(row?.textContent).not.toContain("latest: 3.1.0")
})

test("an exact pin's pinned/latest cell shows just the two values, no annotation", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "e", name: "exact-pkg", pinStyle: "exact", pinned: "1.2.3", latest: "1.3.0" }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("exact-pkg")).toBeInTheDocument())
  const row = screen.getByText("exact-pkg").closest("tr")
  expect(row?.textContent).toContain("1.2.3")
  expect(row?.textContent).toContain("1.3.0")
  expect(row?.textContent).not.toContain("latest:")
})

test("a major-style pin already on the latest major shows just pinned/latest, no redundant annotation", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "fs",
        name: "major-but-current-pkg",
        pinStyle: "major",
        pinned: "^2.4.0",
        latestInMajor: "2.9.0",
        latest: "2.9.0",
        gap: "minor",
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("major-but-current-pkg")).toBeInTheDocument())
  const row = screen.getByText("major-but-current-pkg").closest("tr")
  expect(row?.textContent).toContain("2.9.0")
  expect(row?.textContent).not.toContain("latest:")
})

test("the role filter narrows every repo's table -- role=runtime hides a build/ci row", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "run", name: "runtime-image", role: "runtime" }),
      item({ key: "bld", name: "build-stage-image", role: "build" }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("runtime-image")).toBeInTheDocument())
  expect(screen.getByText("build-stage-image")).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "runtime" } })

  expect(screen.getByText("runtime-image")).toBeInTheDocument()
  expect(screen.queryByText("build-stage-image")).not.toBeInTheDocument()
})

test("clicking the Gap header sorts by severity, not alphabetically", async () => {
  // K4-8a review round 1, LOW: sortValue used to be the raw gap string, so "none" (no gap)
  // sorted between "minor" and "patch" -- lexicographic, not meaningful.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "n", name: "sound-pkg", gap: "none" }),
      item({ key: "p", name: "patch-behind-pkg", gap: "patch" }),
      item({ key: "j", name: "major-behind-pkg", gap: "major" }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("major-behind-pkg")).toBeInTheDocument())

  fireEvent.click(screen.getByRole("button", { name: /Gap/ }))

  const names = within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1) // header
    .map((r) => r.textContent)
    .filter((t) => t && /-pkg/.test(t))
  expect(names[0]).toContain("major-behind-pkg")
  expect(names[1]).toContain("patch-behind-pkg")
  expect(names[2]).toContain("sound-pkg")
})

test("a repo with no items still renders its card, with an empty table message", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({ repo: "Rackbops/no-items" })])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({ snapshot: SNAPSHOT, items: [] })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("Rackbops/no-items")).toBeInTheDocument())
  expect(screen.getByText("No items match these filters.")).toBeInTheDocument()
})
