import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { ReportItem } from "../api.js"
import * as api from "../api.js"
import { NeedsDecision } from "./NeedsDecision.js"

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

test("shows loading, then an ingest-empty message when nothing has been ingested", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(<NeedsDecision />)
  expect(screen.getByText("Loading…")).toBeInTheDocument()
  await waitFor(() =>
    expect(screen.getByText("No data has been ingested yet.")).toBeInTheDocument(),
  )
})

test("shows an error state when the fetch fails", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockRejectedValue(new Error("boom"))
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/))
})

test("shows a positive empty state when nothing currently needs a decision", async () => {
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 1,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [item({ key: "sound", gap: "none", advisoryStatus: "none" })],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("Nothing needs a decision.")).toBeInTheDocument())
})

test("includes an affected item and a gapped item, excludes a sound item and a decided item", async () => {
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 4,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({ key: "affected", name: "vuln-pkg", advisoryStatus: "affected", gap: "none" }),
      item({ key: "gapped", name: "behind-pkg", advisoryStatus: "none", gap: "minor" }),
      item({ key: "sound", name: "fine-pkg", advisoryStatus: "none", gap: "none" }),
      item({
        key: "decided",
        name: "already-decided-pkg",
        advisoryStatus: "none",
        gap: "major",
        decision: {
          updatedAt: "2026-09-01T00:00:00Z",
          updatedBy: "roshne",
          skippedVersion: "9.0.0",
        },
      }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  expect(screen.getByText("vuln-pkg")).toBeInTheDocument()
  expect(screen.getByText("behind-pkg")).toBeInTheDocument()
  expect(screen.queryByText("fine-pkg")).not.toBeInTheDocument()
  expect(screen.queryByText("already-decided-pkg")).not.toBeInTheDocument()
})

test("an affected item is prioritized above a gapped item in row order", async () => {
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 2,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      // Gapped item listed FIRST in the source data -- proves the table orders by priority,
      // not by fetch order.
      item({ key: "gapped", name: "behind-pkg", advisoryStatus: "none", gap: "major" }),
      item({ key: "affected", name: "vuln-pkg", advisoryStatus: "affected", gap: "none" }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1)
  expect(rows[0]?.textContent).toContain("vuln-pkg")
  expect(rows[1]?.textContent).toContain("behind-pkg")
})

test("an affected item's advisories render as links to their real URLs", async () => {
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 1,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({
        key: "vuln",
        name: "vuln-pkg",
        advisoryStatus: "affected",
        advisories: [
          {
            id: "GHSA-7mjv-x3jf-545x",
            summary: "Local Privilege Escalation",
            severity: "high",
            url: "https://github.com/advisories/GHSA-7mjv-x3jf-545x",
            source: "ghsa",
            affected: true,
          },
        ],
      }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("vuln-pkg")).toBeInTheDocument())
  expect(screen.getByRole("link", { name: "GHSA-7mjv-x3jf-545x" })).toHaveAttribute(
    "href",
    "https://github.com/advisories/GHSA-7mjv-x3jf-545x",
  )
})

test("the repo filter narrows the rendered rows", async () => {
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 2,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({ key: "a", name: "in-tooling", repo: "Rackbops/Tooling", advisoryStatus: "affected" }),
      item({ key: "b", name: "in-kenzen", repo: "Rackbops/kenzen", advisoryStatus: "affected" }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("in-tooling")).toBeInTheDocument())
  expect(screen.getByText("in-kenzen")).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "Rackbops/kenzen" } })

  expect(screen.queryByText("in-tooling")).not.toBeInTheDocument()
  expect(screen.getByText("in-kenzen")).toBeInTheDocument()
})
