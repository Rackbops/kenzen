import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { expect, test, vi } from "vitest"
import { App } from "./App.js"
import * as api from "./api.js"

test("renders the nav for all five sections, and the index route shows Needs a decision", async () => {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  for (const label of ["Needs a decision", "Repos", "Decided", "Dependabot", "History"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument()
  }
  // The index route renders NeedsDecision's own fixture content.
  expect(screen.getByText(/Rackbops\/Tooling · pip-dep requests/)).toBeInTheDocument()
})

test("the Repos nav link is marked active on the /repos route, others are not", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([])
  render(
    <MemoryRouter initialEntries={["/repos"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByText("No repos ingested yet.")).toBeInTheDocument())
  expect(screen.getByRole("link", { name: "Repos" })).toHaveClass("rb-link--active")
  expect(screen.getByRole("link", { name: "History" })).not.toHaveClass("rb-link--active")
})

test("navigating to /history renders the History route's content", () => {
  render(
    <MemoryRouter initialEntries={["/history"]}>
      <App />
    </MemoryRouter>,
  )
  expect(screen.getByText("2026-09-01T00:00:00Z")).toBeInTheDocument()
})
