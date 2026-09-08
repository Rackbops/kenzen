import { render, screen, waitFor } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import * as api from "../api.js"
import { Dependabot } from "./Dependabot.js"

test("renders 'not enabled' for a repo with no Dependabot alerts", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([
    {
      repo: "Rackbops/Tooling",
      role: {},
      gap: {},
      advisoryStatus: {},
      dependabotAlerts: "not enabled",
      decided: 0,
      soundness: "0 items · 0 affected · 0 behind (0/0/0) · 0 decided · 0 unknown",
    },
  ])
  render(<Dependabot />)
  await waitFor(() => expect(screen.getByText("Rackbops/Tooling")).toBeInTheDocument())
  expect(screen.getByText("not enabled")).toBeInTheDocument()
})

test("renders an alert count for a repo with real Dependabot alerts", async () => {
  vi.spyOn(api, "fetchRepos").mockResolvedValue([
    {
      repo: "Rackbops/artifact-console",
      role: {},
      gap: {},
      advisoryStatus: {},
      dependabotAlerts: [{ id: 1 }, { id: 2 }],
      decided: 0,
      soundness: "0 items · 0 affected · 0 behind (0/0/0) · 0 decided · 0 unknown",
    },
  ])
  render(<Dependabot />)
  await waitFor(() => expect(screen.getByText("2 alert(s)")).toBeInTheDocument())
})
