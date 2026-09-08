import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { ReportItem } from "./api.js"
import { DecisionActions } from "./DecisionActions.js"

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

test("an undecided item with a resolvable latest shows all four action triggers", () => {
  render(
    <DecisionActions
      item={item({
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
      })}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "7d" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "30d" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "90d" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled()
})

test("Skip and Approve are disabled when latest is null -- nothing to skip/approve to", () => {
  render(<DecisionActions item={item({ latest: null })} onApply={() => {}} error={undefined} />)
  expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled()
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
})

test("Acknowledge is disabled when the item has no advisories", () => {
  render(<DecisionActions item={item({ advisories: [] })} onApply={() => {}} error={undefined} />)
  expect(screen.getByRole("button", { name: "Acknowledge" })).toBeDisabled()
})

test("clicking Skip reveals a one-line confirm naming the target version, not the buttons", () => {
  render(<DecisionActions item={item({ latest: "9.9.9" })} onApply={() => {}} error={undefined} />)
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  expect(screen.getByText(/Skip 9\.9\.9\?/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
})

test("confirming Yes calls onApply with the exact patch and returns to the button row", () => {
  const onApply = vi.fn()
  render(<DecisionActions item={item({ latest: "9.9.9" })} onApply={onApply} error={undefined} />)
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))
  expect(onApply).toHaveBeenCalledWith({ field: "skippedVersion", value: "9.9.9" })
})

test("clicking No cancels back to the button row without calling onApply", () => {
  const onApply = vi.fn()
  render(<DecisionActions item={item({ latest: "9.9.9" })} onApply={onApply} error={undefined} />)
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  fireEvent.click(screen.getByRole("button", { name: "No" }))
  expect(onApply).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument()
})

test("a remind preset computes a future ISO timestamp roughly N days out", () => {
  const onApply = vi.fn()
  const before = Date.now()
  render(<DecisionActions item={item({})} onApply={onApply} error={undefined} />)
  fireEvent.click(screen.getByRole("button", { name: "30d" }))
  fireEvent.click(screen.getByRole("button", { name: "Yes" }))

  expect(onApply).toHaveBeenCalledTimes(1)
  const patch = onApply.mock.calls[0]?.[0]
  expect(patch.field).toBe("remindAt")
  const remindAt = Date.parse(patch.value)
  const expectedMs = before + 30 * 24 * 60 * 60 * 1000
  expect(Math.abs(remindAt - expectedMs)).toBeLessThan(5000)
})

test("acknowledging patches with every one of the item's advisory ids", () => {
  const onApply = vi.fn()
  render(
    <DecisionActions
      item={item({
        advisories: [
          {
            id: "GHSA-1",
            summary: "a",
            severity: "high",
            url: "https://x",
            source: "ghsa",
            affected: true,
          },
          {
            id: "GHSA-2",
            summary: "b",
            severity: "low",
            url: "https://y",
            source: "osv",
            affected: true,
          },
        ],
      })}
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

test("a decided item shows a summary instead of any action buttons", () => {
  render(
    <DecisionActions
      item={item({
        decision: {
          skippedVersion: "9.0.0",
          remindAt: null,
          approvedVersion: null,
          acknowledgedAdvisories: null,
          updatedAt: "2026-09-08T00:00:00Z",
          updatedBy: "roshne",
        },
      })}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Skipped 9.0.0 by roshne")).toBeInTheDocument()
  expect(screen.queryByRole("button")).not.toBeInTheDocument()
})

test("a decided item still pending server confirmation shows the summary with no attribution yet", () => {
  render(
    <DecisionActions
      item={item({
        decision: {
          skippedVersion: "9.0.0",
          remindAt: null,
          approvedVersion: null,
          acknowledgedAdvisories: null,
          updatedAt: "2026-09-08T00:00:00Z",
          updatedBy: null,
        },
      })}
      onApply={() => {}}
      error={undefined}
    />,
  )
  expect(screen.getByText("Skipped 9.0.0")).toBeInTheDocument()
})

test("an error is shown alongside the confirm bar", () => {
  render(
    <DecisionActions item={item({ latest: "9.9.9" })} onApply={() => {}} error="unauthorized" />,
  )
  fireEvent.click(screen.getByRole("button", { name: "Skip" }))
  expect(screen.getByRole("alert")).toHaveTextContent("Failed: unauthorized")
})
