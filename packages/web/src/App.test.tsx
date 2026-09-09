import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { expect, test, vi } from "vitest"
import { App } from "./App.js"
import * as api from "./api.js"

test("renders a tablist with all five view labels", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument())
  for (const label of ["Needs a decision", "Repos", "Decided", "Dependabot", "History"]) {
    expect(screen.getByRole("tab", { name: label })).toBeInTheDocument()
  }
})

test("the index route redirects to needs-decision, and its tab is selected", async () => {
  // K4-7 review round 1, MEDIUM (kenzen#60 kept this behaviour): landing on / must select the
  // same tab as landing on /needs-decision directly, not leave every tab unselected.
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(screen.getByText("No data has been ingested yet.")).toBeInTheDocument(),
  )
  expect(screen.getByRole("tab", { name: "Needs a decision" })).toHaveAttribute(
    "aria-selected",
    "true",
  )
})

test("landing on /decided selects the Decided tab, not Needs a decision", async () => {
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={["/decided"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText("No decisions recorded yet.")).toBeInTheDocument())
  expect(screen.getByRole("tab", { name: "Decided" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("tab", { name: "Needs a decision" })).toHaveAttribute(
    "aria-selected",
    "false",
  )
})

test("a trailing slash on the route still selects the right tab", async () => {
  // A naive `pathname.slice(1)` computes "decided/" for this URL, matching no TABS id --
  // react-router itself renders the Decided route fine (a trailing slash is not a distinct
  // route), so the bug would be a tablist showing real content with no tab marked selected.
  // Regression guard for a review finding on this PR.
  vi.spyOn(api, "fetchDecisions").mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={["/decided/"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText("No decisions recorded yet.")).toBeInTheDocument())
  expect(screen.getByRole("tab", { name: "Decided" })).toHaveAttribute("aria-selected", "true")
})

test("clicking a tab navigates to its route and selects it", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  vi.spyOn(api, "fetchRepos").mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(screen.getByText("No data has been ingested yet.")).toBeInTheDocument(),
  )
  fireEvent.click(screen.getByRole("tab", { name: "Repos" }))
  await waitFor(() => expect(screen.getByText("No repos ingested yet.")).toBeInTheDocument())
  expect(screen.getByRole("tab", { name: "Repos" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("tab", { name: "Needs a decision" })).toHaveAttribute(
    "aria-selected",
    "false",
  )
})

test("navigating to /history renders the History route's content", async () => {
  // K4-8b: this route now fetches real data rather than rendering K4-7's fixture, so the
  // route-level assertion is on its own real empty state.
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  vi.spyOn(api, "fetchRepos").mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={["/history"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText("Soundness")).toBeInTheDocument())
  expect(screen.getByText("No snapshots ingested yet.")).toBeInTheDocument()
})
