import { render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import * as api from "../api.js"
import { Repos } from "./Repos.js"

test("renders a card per repo with its real soundness line", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([
    {
      repo: "Rackbops/Tooling",
      role: { runtime: 3 },
      gap: { patch: 1 },
      advisoryStatus: { none: 3 },
      dependabotAlerts: "not enabled",
      soundness: "3 items · 0 affected · 1 behind (0/0/1) · 0 decided · 0 unknown",
    },
  ])
  render(<Repos />)
  expect(screen.getByText("Loading repos…")).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText("Rackbops/Tooling")).toBeInTheDocument())
  expect(screen.getByText(/3 items · 0 affected/)).toBeInTheDocument()
})

test("renders an empty state when there are no repos yet", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([])
  render(<Repos />)
  await waitFor(() => expect(screen.getByText("No repos ingested yet.")).toBeInTheDocument())
})

test("renders an error state when the fetch fails", async () => {
  vi.spyOn(api, "fetchRepos").mockRejectedValue(new Error("boom"))
  render(<Repos />)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/))
})
