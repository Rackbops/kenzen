import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { Advisory, ItemDecision, ReportItem } from "./api.js"
import { DecisionActions } from "./DecisionActions.js"

const NOW = "2026-09-08T00:00:00Z"

function item(overrides: Partial<ReportItem>): ReportItem {
  return {
    key: "k",
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

function advisory(overrides: Partial<Advisory> = {}): Advisory {
  return {
    id: "GHSA-1",
    summary: "x",
    severity: "high",
    url: "https://x",
    source: "ghsa",
    affected: true,
    ...overrides,
  }
}

function decision(overrides: Partial<ItemDecision>): ItemDecision {
  return {
    skippedVersion: null,
    remindAt: null,
    approvedVersion: null,
    approvedFromPinned: null,
    acknowledgedAdvisories: null,
    updatedAt: NOW,
    updatedBy: "roshne",
    ...overrides,
  }
}

// --- Gap axis (skip/remind/approve share one slot) ---

test("a gapped, undecided item shows Skip/Remind/Approve, no Acknowledge (advisoryStatus is none)", () => {
  render(
    <DecisionActions
      item={item({ gap: "minor" })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "7d" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "30d" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "90d" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument()
})

test("Skip and Approve are disabled when latest is null -- nothing to skip/approve to", () => {
  render(
    <DecisionActions
      item={item({ latest: null })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
})

test("gap none/unknown shows no gap-axis buttons at all", () => {
  render(
    <DecisionActions item={item({ gap: "none" })} now={NOW} onApply={() => {}} error={undefined} />,
  )
  expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
  render(
    <DecisionActions
      item={item({ gap: "unknown" })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.queryAllByRole("button", { name: "Skip" })).toHaveLength(0)
})

test("clicking Skip reveals a one-line confirm naming the target version, not the buttons", () => {
  render(
    <DecisionActions
      item={item({ latest: "9.9.9" })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  expect(screen.getByText(/Skip 9\.9\.9\?/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
})

test("confirming Yes calls onApply with the exact patch and returns to the button row", () => {
  const onApply = vi.fn()
  render(
    <DecisionActions
      item={item({ latest: "9.9.9" })}
      now={NOW}
      onApply={onApply}
      error={undefined}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))
  expect(onApply).toHaveBeenCalledWith({ field: "skippedVersion", value: "9.9.9" })
})

test("clicking No cancels back to the button row without calling onApply", () => {
  const onApply = vi.fn()
  render(
    <DecisionActions
      item={item({ latest: "9.9.9" })}
      now={NOW}
      onApply={onApply}
      error={undefined}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  fireEvent.click(screen.getByRole("button", { name: "No" }))
  expect(onApply).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
})

test("a remind preset computes a future ISO timestamp roughly N days out", () => {
  const onApply = vi.fn()
  const before = Date.now()
  render(<DecisionActions item={item({})} now={NOW} onApply={onApply} error={undefined} />)
  fireEvent.click(screen.getByRole("button", { name: "30d" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))

  expect(onApply).toHaveBeenCalledTimes(1)
  const patch = onApply.mock.calls[0]?.[0]
  expect(patch.field).toBe("remindAt")
  const remindAt = Date.parse(patch.value)
  const expectedMs = before + 30 * 24 * 60 * 60 * 1000
  expect(Math.abs(remindAt - expectedMs)).toBeLessThan(5000)
})

test("a still-current skip shows the gap summary, not buttons", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        latest: "9.0.0",
        decision: decision({ skippedVersion: "9.0.0" }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Skipped 9.0.0 by roshne")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
})

test("a skip superseded by a newer latest resurfaces the gap buttons, not the stale summary", () => {
  // The exact scenario round 1 review found broken: a resurfaced decision must be actionable
  // again, not frozen on a summary of a decision that no longer holds.
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        latest: "10.0.0",
        decision: decision({ skippedVersion: "9.0.0" }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
  expect(screen.queryByText(/Skipped 9\.0\.0/)).not.toBeInTheDocument()
})

test("a remind not yet due shows the gap summary, not buttons", () => {
  render(
    <DecisionActions
      item={item({ gap: "minor", decision: decision({ remindAt: "2026-12-01T00:00:00Z" }) })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Snoozed until 2026-12-01T00:00:00Z by roshne")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
})

test("a remind whose date has passed resurfaces the gap buttons -- the whole point of remind", () => {
  render(
    <DecisionActions
      item={item({ gap: "minor", decision: decision({ remindAt: "2026-01-01T00:00:00Z" }) })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
  expect(screen.queryByText(/Snoozed/)).not.toBeInTheDocument()
})

test("a still-current approval shows the gap summary, not buttons", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        pinned: "4.0.0",
        latest: "4.1.0",
        decision: decision({ approvedVersion: "4.1.0", approvedFromPinned: "4.0.0" }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Approved 4.1.0 by roshne")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
})

test("a real PUT response's decision (fields OMITTED when unset, not explicit null) still shows the right summary -- round 3 review, HIGH, live-reproduced: strict !== null read 'Skipped undefined' after a real Approve", () => {
  // decisions-route.ts's decisionJson (what a real PUT/GET /api/decisions response actually
  // sends, and what useOptimisticDecisions.ts stores verbatim as the confirmed decision) omits
  // an unset field entirely rather than sending explicit null -- unlike this file's own
  // decision() helper, which (like snapshots-route.ts's toReportItem) always populates every
  // field. A cast is the honest way to build this fixture: it simulates the real wire shape,
  // which is exactly where the TS type (never undefined) and the JS runtime (sometimes an
  // absent key) actually diverge.
  const omissionShapedDecision = {
    approvedVersion: "6.0.0",
    approvedFromPinned: "5.0.0",
    updatedAt: NOW,
    updatedBy: "roshne",
  } as unknown as ItemDecision

  render(
    <DecisionActions
      item={item({
        gap: "minor",
        pinned: "5.0.0",
        latest: "6.0.0",
        decision: omissionShapedDecision,
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Approved 6.0.0 by roshne")).toBeInTheDocument()
  expect(screen.queryByText(/Skipped/)).not.toBeInTheDocument()
})

test("an approval whose pinned has since moved (the PR merged) resurfaces the gap buttons -- K4-9 round 2 coverage gap: approvedFromPinned reaching the client is what this path depends on", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        pinned: "4.1.0",
        latest: "4.1.0",
        decision: decision({ approvedVersion: "4.1.0", approvedFromPinned: "4.0.0" }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
  expect(screen.queryByText(/Approved/)).not.toBeInTheDocument()
})

test("an approval superseded by a newer latest resurfaces the gap buttons even when pinned hasn't moved", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        pinned: "4.0.0",
        latest: "4.2.0",
        decision: decision({ approvedVersion: "4.1.0", approvedFromPinned: "4.0.0" }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument()
  expect(screen.queryByText(/Approved/)).not.toBeInTheDocument()
})

// --- Advisory axis (acknowledge), independent of the gap axis ---

test("an affected item with no gap shows only Acknowledge, no gap-axis buttons", () => {
  render(
    <DecisionActions
      item={item({ gap: "none", advisoryStatus: "affected", advisories: [advisory()] })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled()
  expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument()
})

test("acknowledging patches with every one of the item's advisory ids", () => {
  const onApply = vi.fn()
  render(
    <DecisionActions
      item={item({
        gap: "none",
        advisoryStatus: "affected",
        advisories: [advisory({ id: "GHSA-1" }), advisory({ id: "GHSA-2" })],
      })}
      now={NOW}
      onApply={onApply}
      error={undefined}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))
  expect(onApply).toHaveBeenCalledWith({
    field: "acknowledgedAdvisories",
    value: ["GHSA-1", "GHSA-2"],
  })
})

test("a fully acknowledged item shows the advisory summary, not the button", () => {
  render(
    <DecisionActions
      item={item({
        gap: "none",
        advisoryStatus: "affected",
        advisories: [advisory({ id: "GHSA-1" })],
        decision: decision({ acknowledgedAdvisories: ["GHSA-1"] }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Acknowledged 1 advisory by roshne")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Acknowledge" })).not.toBeInTheDocument()
})

test("a new unacknowledged advisory resurfaces Acknowledge even though an older one was acknowledged", () => {
  render(
    <DecisionActions
      item={item({
        gap: "none",
        advisoryStatus: "affected",
        advisories: [advisory({ id: "GHSA-1" }), advisory({ id: "GHSA-2" })],
        decision: decision({ acknowledgedAdvisories: ["GHSA-1"] }), // GHSA-2 is new, unacknowledged
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument()
})

// --- Both axes open at once, and both independently resolved ---

test("both axes open at once render both independently -- skip buttons AND acknowledge button together", () => {
  render(
    <DecisionActions
      item={item({ gap: "minor", advisoryStatus: "affected", advisories: [advisory()] })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument()
})

test("gap decided but advisory still open shows the gap summary AND the acknowledge button, not just one", () => {
  // The other half of the exact bug round 1 review found: axes must be independent.
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        latest: "9.0.0",
        advisoryStatus: "affected",
        advisories: [advisory()],
        decision: decision({ skippedVersion: "9.0.0" }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Skipped 9.0.0 by roshne")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeInTheDocument()
})

test("advisory acknowledged but gap still open shows the advisory summary AND the gap buttons", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        advisoryStatus: "affected",
        advisories: [advisory({ id: "GHSA-1" })],
        decision: decision({ acknowledgedAdvisories: ["GHSA-1"] }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Acknowledged 1 advisory by roshne")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
})

// --- Nothing to show at all ---

test("a fully sound, never-decided item renders nothing", () => {
  const { container } = render(
    <DecisionActions
      item={item({ gap: "none", advisoryStatus: "none" })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(container).toBeEmptyDOMElement()
})

test("a decision fully settled on both axes (no longer affected, gap suppressed) shows both summaries and no buttons", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        latest: "9.0.0",
        advisoryStatus: "affected",
        advisories: [advisory({ id: "GHSA-1" })],
        decision: decision({ skippedVersion: "9.0.0", acknowledgedAdvisories: ["GHSA-1"] }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Skipped 9.0.0 by roshne")).toBeInTheDocument()
  expect(screen.getByText("Acknowledged 1 advisory by roshne")).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

// --- Misc ---

test("a decided item still pending server confirmation shows the summary with no attribution yet", () => {
  render(
    <DecisionActions
      item={item({
        gap: "minor",
        latest: "9.0.0",
        decision: decision({ skippedVersion: "9.0.0", updatedBy: null }),
      })}
      now={NOW}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Skipped 9.0.0")).toBeInTheDocument()
})

test("an error is shown alongside the confirm bar", () => {
  render(
    <DecisionActions
      item={item({ latest: "9.9.9" })}
      now={NOW}
      onApply={() => {}}
      error="unauthorized"
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  expect(screen.getByRole("alert")).toHaveTextContent("Failed: unauthorized")
})
