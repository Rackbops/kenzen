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
  await waitFor(() => expect(screen.getByText("The stream is clean.")).toBeInTheDocument())
})

test("kenzen#96: the positive empty state shows the large kanji heading above its caption", async () => {
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
  const { container } = render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("The stream is clean.")).toBeInTheDocument())
  const heading = container.querySelector(".kz-kanji--heading")
  expect(heading).not.toBeNull()
  expect(heading).toHaveTextContent("健全性")
  expect(heading).toHaveAttribute("lang", "ja")
})

test("kenzen#92: the positive empty state shows the koi banner, decorative, above its caption", async () => {
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
  const { container } = render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("The stream is clean.")).toBeInTheDocument())
  const banner = container.querySelector(".kz-empty-state__banner")
  expect(banner).not.toBeNull()
  expect(banner).toHaveAttribute("src", "/brand/koi-banner.webp")
  expect(banner).toHaveAttribute("alt", "")
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
          remindAt: null,
          approvedVersion: null,
          approvedFromPinned: null,
          acknowledgedAdvisories: null,
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

test("each of major, minor, and patch individually counts as needing a decision", async () => {
  // Round 3 mutation-testing found this real gap: the existing tests only ever exercised
  // gap="minor" (included) and gap="major" (excluded via a decision), so dropping the
  // `|| item.gap === "patch"` branch of needsDecision() left the full suite green.
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 3,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({ key: "j", name: "major-behind-pkg", advisoryStatus: "none", gap: "major" }),
      item({ key: "n", name: "minor-behind-pkg", advisoryStatus: "none", gap: "minor" }),
      item({ key: "p", name: "patch-behind-pkg", advisoryStatus: "none", gap: "patch" }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  expect(screen.getByText("major-behind-pkg")).toBeInTheDocument()
  expect(screen.getByText("minor-behind-pkg")).toBeInTheDocument()
  expect(screen.getByText("patch-behind-pkg")).toBeInTheDocument()
})

test("clicking the Pinned header orders rows by name", async () => {
  // kenzen#113: Pinned -> latest had no sortValue at all -- clicking it did nothing.
  // Sorting by name (not the pinned version) keeps rows of one dependency together.
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 3,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({ key: "z", name: "zeta-pkg", pinned: "1.0.0", gap: "patch" }),
      item({ key: "a", name: "alpha-pkg", pinned: "2.0.0", gap: "patch" }),
      item({ key: "m", name: "mid-pkg", pinned: "1.5.0", gap: "patch" }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("zeta-pkg")).toBeInTheDocument())

  fireEvent.click(screen.getByRole("button", { name: /Pinned/ }))

  const names = within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1) // header
    .map((r) => r.textContent)
    .filter((t) => t && /-pkg/.test(t))
  expect(names[0]).toContain("alpha-pkg")
  expect(names[1]).toContain("mid-pkg")
  expect(names[2]).toContain("zeta-pkg")
})

test("clicking the Advisories header puts the row with more advisories first", async () => {
  // kenzen#113: Advisories had no sortValue at all -- clicking it did nothing. Sorts by
  // advisoryStatus severity first (affected before a non-affected gap-only row), advisory
  // count second.
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 3,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({ key: "g", name: "gap-only-pkg", advisoryStatus: "none", gap: "patch" }),
      item({
        key: "f",
        name: "few-cves-pkg",
        advisoryStatus: "affected",
        gap: "none",
        advisories: [
          { id: "CVE-1", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
        ],
      }),
      item({
        key: "n",
        name: "many-cves-pkg",
        advisoryStatus: "affected",
        gap: "none",
        advisories: [
          { id: "CVE-2", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
          { id: "CVE-3", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
          { id: "CVE-4", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
        ],
      }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("many-cves-pkg")).toBeInTheDocument())

  fireEvent.click(screen.getByRole("button", { name: /Advisories/ }))

  const names = within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1) // header
    .map((r) => r.textContent)
    .filter((t) => t && /-pkg/.test(t))
  expect(names[0]).toContain("many-cves-pkg")
  expect(names[1]).toContain("few-cves-pkg")
  expect(names[2]).toContain("gap-only-pkg")
})

test("kenzen#119: the table declares its 8 column widths via colgroup; kenzen#70's three-control Actions grouping still holds", async () => {
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
        key: "a",
        name: "behind-pkg",
        gap: "minor",
        advisoryStatus: "affected",
        advisories: [
          {
            id: "GHSA-1",
            summary: "x",
            severity: "high",
            url: "https://x",
            source: "ghsa",
            affected: true,
          },
        ],
      }),
    ],
  })
  const { container } = render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  // kenzen#119: DataTableColumn.width renders a <colgroup> ahead of <thead> and puts the table
  // in table-layout: fixed itself -- this is the acceptance's "equal across renders" claim
  // expressed as a unit test, since a colgroup's widths never depend on row content.
  const table = screen.getByRole("table")
  expect(table).toHaveStyle({ tableLayout: "fixed" })
  const cols = container.querySelectorAll("colgroup > col")
  expect(Array.from(cols).map((c) => (c as HTMLElement).style.width)).toEqual([
    "13%",
    "9%",
    "17%",
    "12%",
    "10%",
    "13%",
    "8%",
    "18%",
  ])
  // kenzen#70 round 2, review round 1: the earlier version of this assertion used a gap-only
  // item (the two-control case), which never exercises the three-control (gap AND advisory)
  // combination that actually wrapped -- an item with all three controls moved outside
  // `.kz-actions` would have passed the old assertion. This item carries both axes, and checks
  // all three controls are children of the SAME `.kz-actions` element.
  const actions = container.querySelector(".kz-actions")
  expect(actions).not.toBeNull()
  // Direct children only -- the Skip <details> also nests the four gap-option buttons inside its
  // own panel, which querySelectorAll("button") would wrongly include.
  const controlTexts = actions
    ? Array.from(actions.children).map((el) =>
        el.tagName === "DETAILS"
          ? el.querySelector("summary")?.textContent?.trim()
          : el.textContent?.trim(),
      )
    : []
  expect(controlTexts).toEqual(["Skip ▾", "Approve", "Acknowledge"])
})

test("kenzen#133: the gap and advisory chips render at the md (row-text) size", async () => {
  // Upstream rackbops-ui-ux-std-lib#206/#208 (@rackbops/ui-react 0.2.39) added Badge size="md" -> .rb-badge--md, a
  // row-text-sized pill; this app adopts it for its items-table status chips (the original
  // illegibility complaint). This item carries BOTH a gap and an advisory, so both chips render
  // -- dropping size="md" from either Badge site drops this count below 2.
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
        key: "a",
        name: "behind-and-vuln-pkg",
        gap: "minor",
        advisoryStatus: "affected",
        advisories: [
          {
            id: "GHSA-1",
            summary: "x",
            severity: "high",
            url: "https://x",
            source: "ghsa",
            affected: true,
          },
        ],
      }),
    ],
  })
  const { container } = render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("behind-and-vuln-pkg")).toBeInTheDocument())
  expect(container.querySelectorAll(".rb-badge--md")).toHaveLength(2)
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
  // kenzen#63: the id list is collapsed behind a disclosure by default -- open it before
  // asserting on the link.
  fireEvent.click(screen.getByText("show ids"))
  expect(screen.getByRole("link", { name: "GHSA-7mjv-x3jf-545x" })).toHaveAttribute(
    "href",
    "https://github.com/advisories/GHSA-7mjv-x3jf-545x",
  )
})

test("kenzen#90: an affected item shows the vulnerable shield before its advisory badge", async () => {
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
        gap: "none",
        advisories: [
          {
            id: "GHSA-1",
            summary: "x",
            severity: "high",
            url: "https://x",
            source: "ghsa",
            affected: true,
          },
        ],
      }),
    ],
  })
  const { container } = render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("vuln-pkg")).toBeInTheDocument())
  const advisoryBadge = container.querySelector(".kz-advisories-cell .kz-status-badge")
  expect(advisoryBadge).not.toBeNull()
  expect(advisoryBadge?.querySelector("img")).toHaveAttribute(
    "src",
    "/brand/shield-vulnerable-32.png",
  )
})

test("kenzen#90: a clean (gap=none) item shows the healthy shield before its gap badge", async () => {
  // needsDecision() only surfaces a sound-gap row when its OTHER axis (advisories) is what
  // actually earns it a place in this table -- pairing gap: "none" with advisoryStatus:
  // "affected" is the only way a "clean gap" row appears here at all.
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
        key: "clean-gap",
        name: "clean-gap-pkg",
        gap: "none",
        advisoryStatus: "affected",
        advisories: [
          {
            id: "GHSA-2",
            summary: "y",
            severity: "high",
            url: "https://y",
            source: "ghsa",
            affected: true,
          },
        ],
      }),
    ],
  })
  const { container } = render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("clean-gap-pkg")).toBeInTheDocument())
  const row = screen.getByText("clean-gap-pkg").closest("tr")
  const gapCell = row?.querySelectorAll("td")[4]
  const gapShield = gapCell?.querySelector(".kz-status-badge img")
  expect(gapShield).toHaveAttribute("src", "/brand/shield-healthy-32.png")
  // sanity: not accidentally reading the advisory cell's own (differently-variant) shield
  const advisoryShield = container.querySelector(".kz-advisories-cell .kz-status-badge img")
  expect(advisoryShield).toHaveAttribute("src", "/brand/shield-vulnerable-32.png")
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

test("kenzen#107: a filter combination matching nothing shows a message, not a silently empty table", async () => {
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 2,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({
        key: "a",
        name: "in-tooling",
        repo: "Rackbops/Tooling",
        kind: "pip-dep",
        advisoryStatus: "affected",
      }),
      item({
        key: "b",
        name: "in-kenzen",
        repo: "Rackbops/kenzen",
        kind: "npm-dep",
        advisoryStatus: "affected",
      }),
    ],
  })
  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("in-tooling")).toBeInTheDocument())

  // Each value alone is a real option (present on one of the two items) -- the combination of
  // BOTH is what matches nothing, not an out-of-range select value.
  fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "Rackbops/kenzen" } })
  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "pip-dep" } })

  expect(screen.queryByText("in-tooling")).not.toBeInTheDocument()
  expect(screen.queryByText("in-kenzen")).not.toBeInTheDocument()
  expect(screen.getByText("No items match these filters.")).toBeInTheDocument()
  // The positive empty state (kanji + banner) is reserved for "no candidates at all" -- it
  // must NOT appear here, since there ARE candidates, just none matching this filter combo.
  expect(screen.queryByText("The stream is clean.")).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "" } })
  expect(screen.queryByText("No items match these filters.")).not.toBeInTheDocument()
  expect(screen.getByText("in-kenzen")).toBeInTheDocument()
})

test("end to end: skipping an item on the real page calls putDecision and removes the row", async () => {
  // Integration test, not another unit test for a piece already covered elsewhere
  // (DecisionActions.test.tsx, useOptimisticDecisions.test.ts) -- proves NeedsDecision.tsx
  // actually wires them together: a real click through the real rendered page reaches the
  // real api.putDecision call and the row disappears via needsDecision's own re-filter, not
  // a mocked shortcut.
  const snapshot = {
    snapshotId: 1,
    generatedAt: "2026-09-08T00:00:00Z",
    inventoryItems: 1,
    summary: {},
  }
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot,
    items: [
      item({ key: "a", name: "behind-pkg", advisoryStatus: "none", gap: "minor", latest: "9.9.9" }),
    ],
  })
  const putDecision = vi.spyOn(api, "putDecision").mockResolvedValue({
    skippedVersion: "9.9.9",
    remindAt: null,
    approvedVersion: null,
    approvedFromPinned: null,
    acknowledgedAdvisories: null,
    updatedAt: "2026-09-08T00:00:00Z",
    updatedBy: "roshne",
  })

  render(<NeedsDecision />)
  await waitFor(() => expect(screen.getByText("behind-pkg")).toBeInTheDocument())

  fireEvent.click(screen.getByText("Skip ▾"))
  fireEvent.click(screen.getByRole("button", { name: "Skip 9.9.9" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))

  expect(putDecision).toHaveBeenCalledWith(
    "a",
    { field: "skippedVersion", value: "9.9.9" },
    expect.anything(),
  )
  await waitFor(() => expect(screen.getByText("The stream is clean.")).toBeInTheDocument())
})
