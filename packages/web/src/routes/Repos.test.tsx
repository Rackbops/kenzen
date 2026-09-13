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
    decided: 0,
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

test("kenzen#119: each repo's table declares its 7 column widths via colgroup; kenzen#70's three-control Actions grouping still holds", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "a",
        name: "requests",
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
  const { container } = render(<Repos />)
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument())
  // kenzen#119: DataTableColumn.width renders a <colgroup> ahead of <thead> and puts the table
  // in table-layout: fixed itself.
  const table = screen.getByRole("table")
  expect(table).toHaveStyle({ tableLayout: "fixed" })
  const cols = container.querySelectorAll("colgroup > col")
  expect(Array.from(cols).map((c) => (c as HTMLElement).style.width)).toEqual([
    "9%",
    "24%",
    "12%",
    "8%",
    "10%",
    "19%",
    "18%",
  ])
  // kenzen#70 round 2, review round 1: the earlier version of this assertion used a gap-only
  // item (the two-control case), which never exercises the three-control (gap AND advisory)
  // combination that actually wrapped -- an item with all three controls moved outside
  // `.kz-actions` would have passed the old assertion. This item carries both axes, and checks
  // all three controls are children of the SAME `.kz-actions` element.
  const actions = container.querySelector(".kz-actions")
  expect(actions).not.toBeNull()
  const controlTexts = actions
    ? Array.from(actions.children).map((el) =>
        el.tagName === "DETAILS"
          ? el.querySelector("summary")?.textContent?.trim()
          : el.textContent?.trim(),
      )
    : []
  expect(controlTexts).toEqual(["Skip ▾", "Approve", "Acknowledge"])
})

test("kenzen#119: two repos' tables carry identical column widths (the #70 symptom this issue fixes)", async () => {
  // kenzen#70's original symptom: each repo's table auto-sized from its own content, so column
  // x-positions drifted 1118-1414px across repos at the same card width. A colgroup's widths
  // come from the shared `columns()` definition, not row content, so they can't drift -- this
  // is that acceptance claim as a unit test, independent of any real page's content.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([
    repoSummary({ repo: "Owner/repo-one" }),
    repoSummary({ repo: "Owner/repo-two" }),
  ])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "a", repo: "Owner/repo-one", name: "short" }),
      item({ key: "b", repo: "Owner/repo-two", name: "a-much-longer-package-name-than-short" }),
    ],
  })
  const { container } = render(<Repos />)
  await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2))

  const widthLists = Array.from(container.querySelectorAll("table")).map((table) =>
    Array.from(table.querySelectorAll("colgroup > col")).map((c) => (c as HTMLElement).style.width),
  )
  expect(widthLists).toHaveLength(2)
  expect(widthLists[0]).toEqual(["9%", "24%", "12%", "8%", "10%", "19%", "18%"])
  expect(widthLists[0]).toEqual(widthLists[1])
})

// --- kenzen#109: the koi hero renders above the repo list, in every state -------------

test("kenzen#109: the koi hero renders above the repo list", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [item({ key: "a", name: "requests" })],
  })
  const { container } = render(<Repos />)
  await waitFor(() => expect(screen.getByText("Rackbops/Tooling")).toBeInTheDocument())
  const hero = container.querySelector(".kz-hero")
  const card = container.querySelector(".rb-card")
  expect(hero).not.toBeNull()
  expect(card).not.toBeNull()
  expect(
    (hero as Element).compareDocumentPosition(card as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

test("kenzen#109: the koi hero renders while loading", () => {
  vi.spyOn(api, "fetchRepos").mockReturnValue(new Promise(() => {}))
  vi.spyOn(api, "fetchLatestSnapshotItems").mockReturnValue(new Promise(() => {}))
  const { container } = render(<Repos />)
  expect(screen.getByText("Loading repos…")).toBeInTheDocument()
  expect(container.querySelector(".kz-hero")).not.toBeNull()
})

test("kenzen#109: the koi hero renders on a repos fetch error", async () => {
  vi.spyOn(api, "fetchRepos").mockRejectedValue(new Error("boom"))
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  const { container } = render(<Repos />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/))
  expect(container.querySelector(".kz-hero")).not.toBeNull()
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

test("a historical-only item's advisories render as links, not just the status word", async () => {
  // Matches the real cloudflared/rackbops-discord-bot acceptance scenario: historical-only
  // advisories are exactly as linkable as an affected item's (round 2, MEDIUM: advisory links
  // were named in kenzen#10's own Scope line alongside source links, but never built).
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "cf",
        name: "cloudflare/cloudflared",
        kind: "compose-image",
        advisoryStatus: "historical-only",
        advisories: [
          {
            id: "GHSA-hgwp-4vp4-qmm2",
            summary: "Local Privilege Escalation in cloudflared",
            severity: "high",
            url: "https://github.com/advisories/GHSA-hgwp-4vp4-qmm2",
            source: "ghsa",
            affected: false,
          },
        ],
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("cloudflare/cloudflared")).toBeInTheDocument())
  const table = screen.getByRole("table")
  expect(within(table).getByText("historical-only")).toBeInTheDocument()
  // kenzen#63: the id list is collapsed behind a disclosure by default -- open it before
  // asserting on the link.
  fireEvent.click(within(table).getByText("show ids"))
  expect(within(table).getByRole("link", { name: "GHSA-hgwp-4vp4-qmm2" })).toHaveAttribute(
    "href",
    "https://github.com/advisories/GHSA-hgwp-4vp4-qmm2",
  )
})

test("kenzen#90: a major-gap item shows the attention shield before its gap badge", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [item({ key: "maj", name: "major-gap-pkg", gap: "major" })],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("major-gap-pkg")).toBeInTheDocument())
  const row = screen.getByText("major-gap-pkg").closest("tr")
  const shield = row?.querySelector(".kz-status-badge img")
  expect(shield).toHaveAttribute("src", "/brand/shield-attention-32.png")
})

test("kenzen#90: a historical-only advisory item shows the healthy shield before its advisory badge", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({
        key: "hist",
        name: "historical-pkg",
        advisoryStatus: "historical-only",
        advisories: [
          {
            id: "GHSA-3",
            summary: "z",
            severity: "high",
            url: "https://z",
            source: "ghsa",
            affected: false,
          },
        ],
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("historical-pkg")).toBeInTheDocument())
  const row = screen.getByText("historical-pkg").closest("tr")
  const shield = row?.querySelector(".kz-status-badge img")
  expect(shield).toHaveAttribute("src", "/brand/shield-healthy-32.png")
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

test("clicking the Pinned header orders rows by name", async () => {
  // kenzen#113: Pinned -> latest had no sortValue at all -- clicking it did nothing.
  // Sorting by name (not the pinned version) keeps rows of one dependency together.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "z", name: "zeta-pkg", pinned: "1.0.0" }),
      item({ key: "a", name: "alpha-pkg", pinned: "2.0.0" }),
      item({ key: "m", name: "mid-pkg", pinned: "1.5.0" }),
    ],
  })
  render(<Repos />)
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
  // advisoryStatus severity first (affected before none), advisory count second.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "c", name: "clean-pkg", advisoryStatus: "none", advisories: [] }),
      item({
        key: "f",
        name: "few-cves-pkg",
        advisoryStatus: "affected",
        advisories: [
          { id: "CVE-1", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
        ],
      }),
      item({
        key: "n",
        name: "many-cves-pkg",
        advisoryStatus: "affected",
        advisories: [
          { id: "CVE-2", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
          { id: "CVE-3", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
          { id: "CVE-4", summary: "s", severity: "high", url: "u", source: "ghsa", affected: true },
        ],
      }),
    ],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("many-cves-pkg")).toBeInTheDocument())

  fireEvent.click(screen.getByRole("button", { name: /Advisories/ }))

  const names = within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1) // header
    .map((r) => r.textContent)
    .filter((t) => t && /-pkg/.test(t))
  expect(names[0]).toContain("many-cves-pkg")
  expect(names[1]).toContain("few-cves-pkg")
  expect(names[2]).toContain("clean-pkg")
})

test("a repo with no items still renders its card, with an empty table message", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({ repo: "Rackbops/no-items" })])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({ snapshot: SNAPSHOT, items: [] })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("Rackbops/no-items")).toBeInTheDocument())
  expect(screen.getByText("No items match these filters.")).toBeInTheDocument()
})

test("a sound item's row has no decision-action buttons at all", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [item({ key: "s", name: "sound-pkg", gap: "none", advisoryStatus: "none" })],
  })
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("sound-pkg")).toBeInTheDocument())
  const row = screen.getByText("sound-pkg").closest("tr")
  expect(row ? within(row).queryByRole("button") : null).toBeNull()
})

test("end to end: skipping an item on the real Repos page calls putDecision and shows the decided summary", async () => {
  // Integration test proving Repos.tsx wires DecisionActions/useOptimisticDecisions together
  // for real, the same way NeedsDecision.test.tsx proves it for that page.
  vi.spyOn(api, "fetchRepos").mockResolvedValue([repoSummary({})])
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue({
    snapshot: SNAPSHOT,
    items: [
      item({ key: "a", name: "behind-pkg", gap: "minor", advisoryStatus: "none", latest: "9.9.9" }),
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

  render(<Repos />)
  await waitFor(() => expect(screen.getByText("behind-pkg")).toBeInTheDocument())

  fireEvent.click(screen.getByText("Skip ▾"))
  fireEvent.click(screen.getByRole("button", { name: "Skip 9.9.9" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))

  expect(putDecision).toHaveBeenCalledWith(
    "a",
    { field: "skippedVersion", value: "9.9.9" },
    expect.anything(),
  )
  await waitFor(() => expect(screen.getByText("Skipped 9.9.9 by roshne")).toBeInTheDocument())
})
