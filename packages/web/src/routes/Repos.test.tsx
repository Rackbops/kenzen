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

test("renders an error state when either fetch fails", async () => {
  vi.spyOn(api, "fetchRepos").mockRejectedValue(new Error("boom"))
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(<Repos />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/))
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

test("a floating-major pin shows latestInMajor with latest annotated alongside", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "f",
        name: "floating-pkg",
        pinStyle: "floating",
        pinned: "^2.4.0",
        latestInMajor: "2.9.0",
        latest: "3.1.0",
        gap: "major",
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("floating-pkg")).toBeInTheDocument())
  const row = screen.getByText("floating-pkg").closest("tr")
  expect(row?.textContent).toContain("2.9.0")
  expect(row?.textContent).toContain("latest: 3.1.0")
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

test("a floating pin already on the latest major shows just pinned/latest, no redundant annotation", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "fs",
        name: "floating-but-current-pkg",
        pinStyle: "floating",
        pinned: "^2.4.0",
        latestInMajor: "2.9.0",
        latest: "2.9.0",
        gap: "minor",
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("floating-but-current-pkg")).toBeInTheDocument())
  const row = screen.getByText("floating-but-current-pkg").closest("tr")
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

test("a repo with no items still renders its card, with an empty table message", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({ repo: "Rackbops/no-items" })])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({ snapshot: SNAPSHOT, items: [] })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("Rackbops/no-items")).toBeInTheDocument())
  expect(screen.getByText("No items match these filters.")).toBeInTheDocument()
})
