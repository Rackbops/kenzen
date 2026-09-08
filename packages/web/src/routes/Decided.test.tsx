import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { DecisionRecord } from "../api.js"
import * as api from "../api.js"
import { Decided, decisionDetail, decisionStates } from "./Decided.js"

function decision(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    key: overrides.key ?? "Rackbops/Tooling|pip-dep|requests|requirements.txt:3",
    repo: "Rackbops/Tooling",
    name: "requests",
    kind: "pip-dep",
    updatedAt: "2026-09-01T00:00:00Z",
    updatedBy: "roshne",
    ...overrides,
  }
}

// --- the state split (design.md section 5) ------------------------------------------------
test("a decision carrying several fields appears under every state it holds", () => {
  // The API genuinely allows this (a skip AND an acknowledgement on one row), so bucketing it
  // into exactly one tab would make it vanish from the other.
  const d = decision({ skippedVersion: "2.32.0", acknowledgedAdvisories: ["GHSA-1"] })
  expect(decisionStates(d)).toEqual(["skipped", "acknowledged"])
})

test("a present-but-empty acknowledgedAdvisories still counts as a state", () => {
  // Review round 1, LOW: the server accepts PUT {"acknowledgedAdvisories": []} and stores a
  // real row. Treating that as "no state" put it in no bucket at all -- invisible in every
  // tab and in every badge, while still counting toward `decisions.length` so the "no
  // decisions" copy did not show either. The row existed with no way to clear it from the UI.
  expect(decisionStates(decision({ acknowledgedAdvisories: [] }))).toEqual(["acknowledged"])
})

test("an empty acknowledgement list renders explicitly, not as a blank cell", () => {
  expect(decisionDetail(decision({ acknowledgedAdvisories: [] }), "acknowledged")).toBe(
    "(none listed)",
  )
})

test("a decision that would otherwise be stranded is clearable", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([
    decision({ key: "stranded", acknowledgedAdvisories: [] }),
  ])
  render(<Decided />)
  fireEvent.click(await screen.findByRole("tab", { name: /Advisories acknowledged/ }))
  expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
})

test("each state's detail cell describes that state, not another", () => {
  const d = decision({ skippedVersion: "2.32.0", remindAt: "2026-10-01T00:00:00Z" })
  expect(decisionDetail(d, "skipped")).toBe("until newer than 2.32.0")
  expect(decisionDetail(d, "snoozed")).toBe("until 2026-10-01T00:00:00Z")
})

test("the approved state is detected and described", () => {
  // Review round 1: no test set approvedVersion at all, so dropping it from decisionStates or
  // returning the wrong field from decisionDetail left the whole suite green -- one of the four
  // states was effectively unimplemented as far as the tests were concerned.
  const d = decision({ approvedVersion: "3.0.0" })
  expect(decisionStates(d)).toEqual(["approved"])
  expect(decisionDetail(d, "approved")).toBe("approved 3.0.0")
})

test("an approved decision renders under its own tab", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([
    decision({ key: "ap", name: "hono", approvedVersion: "3.0.0" }),
  ])
  render(<Decided />)
  fireEvent.click(await screen.findByRole("tab", { name: /Approved/ }))
  expect(screen.getByText("hono (pip-dep)")).toBeInTheDocument()
  expect(screen.getByText("approved 3.0.0")).toBeInTheDocument()
})

// --- rendering ----------------------------------------------------------------------------
test("renders a skipped decision with its target, who and when", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([decision({ skippedVersion: "2.32.0" })])
  render(<Decided />)
  await waitFor(() => expect(screen.getByText("requests (pip-dep)")).toBeInTheDocument())
  expect(screen.getByText("until newer than 2.32.0")).toBeInTheDocument()
  expect(screen.getByText("roshne")).toBeInTheDocument()
  expect(screen.getByText("2026-09-01T00:00:00Z")).toBeInTheDocument()
})

test("a decision with no identity on record renders 'unknown', not a blank cell", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([
    decision({ skippedVersion: "1.0.0", updatedBy: null }),
  ])
  render(<Decided />)
  await waitFor(() => expect(screen.getByText("unknown")).toBeInTheDocument())
})

test("switching tabs shows that state's rows and not the other's", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([
    decision({ key: "a", name: "requests", skippedVersion: "2.32.0" }),
    decision({ key: "b", name: "hono", remindAt: "2026-10-01T00:00:00Z" }),
  ])
  render(<Decided />)
  await waitFor(() => expect(screen.getByText("requests (pip-dep)")).toBeInTheDocument())
  expect(screen.queryByText("hono (pip-dep)")).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole("tab", { name: /Snoozed/ }))
  expect(screen.getByText("hono (pip-dep)")).toBeInTheDocument()
  expect(screen.queryByText("requests (pip-dep)")).not.toBeInTheDocument()
})

test("renders nothing-yet copy when there are no decisions at all", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([])
  render(<Decided />)
  await waitFor(() => expect(screen.getByText("No decisions recorded yet.")).toBeInTheDocument())
})

test("surfaces a load failure instead of rendering an empty table", async () => {
  vi.spyOn(api, "fetchDecisions").mockRejectedValue(new Error("boom"))
  render(<Decided />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("boom"))
})

// --- the clear action ---------------------------------------------------------------------
test("clear calls the API with the decision's key and refetches", async () => {
  const fetchDecisions = vi
    .spyOn(api, "fetchDecisions")
    .mockResolvedValueOnce([decision({ key: "the-key", skippedVersion: "2.32.0" })])
    .mockResolvedValueOnce([])
  const clearDecision = vi.spyOn(api, "clearDecision").mockResolvedValue(undefined)

  render(<Decided />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "Clear" }))

  await waitFor(() => expect(screen.getByText("No decisions recorded yet.")).toBeInTheDocument())
  expect(clearDecision).toHaveBeenCalledWith("the-key")
  // Refetched rather than mutating a local copy: the table must reflect the server.
  expect(fetchDecisions).toHaveBeenCalledTimes(2)
})

test("a second clear does not re-enable the first row's button while it is still in flight", async () => {
  // Review round 1, MEDIUM: `clearing` was a single key, so starting a second clear overwrote
  // the first's marker -- row A re-enabled itself mid-request (inviting a duplicate call) and
  // whichever request settled first cleared the other's pending state.
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([
    decision({ key: "a", name: "alpha", skippedVersion: "1.0.0" }),
    decision({ key: "b", name: "beta", skippedVersion: "2.0.0" }),
  ])
  // Never resolves: both clears stay in flight for the duration of the test.
  vi.spyOn(api, "clearDecision").mockImplementation(() => new Promise<void>(() => {}))

  render(<Decided />)
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(2))
  const [first, second] = screen.getAllByRole("button", { name: "Clear" })
  fireEvent.click(first as HTMLElement)
  fireEvent.click(second as HTMLElement)

  // Both rows must still read as in-flight; neither may have been re-enabled by the other.
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Clearing…" })).toHaveLength(2))
  expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument()
  // Asserted separately from the label: the two are driven by the same state but by different
  // expressions, so a label-only check leaves the actual click-guard unguarded -- a mutation
  // dropping `disabled` survived until this line existed.
  for (const button of screen.getAllByRole("button", { name: "Clearing…" })) {
    expect(button).toBeDisabled()
  }
})

test("a failed clear is surfaced and the row is left in place", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([
    decision({ key: "the-key", skippedVersion: "2.32.0" }),
  ])
  vi.spyOn(api, "clearDecision").mockRejectedValue(new Error("401"))

  render(<Decided />)
  await waitFor(() => expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument())
  fireEvent.click(screen.getByRole("button", { name: "Clear" }))

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("401"))
  // Still there -- a failed clear must not look like a successful one.
  expect(screen.getByText("requests (pip-dep)")).toBeInTheDocument()
})
