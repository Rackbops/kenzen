import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterEach, expect, test, vi } from "vitest"
import { App } from "./App.js"
import * as api from "./api.js"
import {
  BUNDLED_THEMES,
  DEFAULT_THEME,
  orderedForPicker,
  THEME_LOADERS,
  THEME_STORAGE_KEY,
} from "./theme.js"

// kenzen#82: the picker writes real document/localStorage state -- reset both after every
// test in this file so a theme choice in one test can't leak into the next.
afterEach(() => {
  delete document.documentElement.dataset.rbStyle
  window.localStorage.clear()
})

test("kenzen#96: the header wordmark carries the kanji, tagged for assistive tech", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByRole("tablist")).toBeInTheDocument())
  const kanji = screen.getByText("健全性")
  expect(kanji).toHaveAttribute("lang", "ja")
  expect(kanji).toHaveAttribute("aria-label", "kenzen-sei")
})

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

// --- kenzen#82: the header theme picker ---------------------------------------------

test("the theme select lists every bundled theme, Kenzen pair first then alphabetical", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  const select = await screen.findByLabelText("Theme")
  const optionValues = Array.from(select.querySelectorAll("option")).map((o) => o.value)
  expect(optionValues).toEqual(orderedForPicker(BUNDLED_THEMES))
})

test("choosing a theme sets data-rb-style on the root and persists it to localStorage", async () => {
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  render(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  )
  const select = await screen.findByLabelText("Theme")

  fireEvent.change(select, { target: { value: nonDefault } })

  await waitFor(() => expect(document.documentElement.dataset.rbStyle).toBe(nonDefault))
  expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(nonDefault)
})

test("a failed switch is logged, not thrown, and leaves the previous theme in place", async () => {
  // Round-1 review gate finding on kenzen#82: a rejected loadTheme (a real network/chunk-load
  // failure) used to become a silent unhandled promise rejection in the browser.
  vi.spyOn(api, "fetchLatestSnapshotItems").mockResolvedValue(null)
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  const nonDefault = BUNDLED_THEMES.find((name) => name !== DEFAULT_THEME) as string
  const original = THEME_LOADERS[nonDefault]
  THEME_LOADERS[nonDefault] = vi.fn().mockRejectedValue(new Error("network blip"))

  try {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    )
    const select = (await screen.findByLabelText("Theme")) as HTMLSelectElement

    fireEvent.change(select, { target: { value: nonDefault } })

    await waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(nonDefault), expect.any(Error)),
    )
    expect(document.documentElement.dataset.rbStyle).not.toBe(nonDefault)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).not.toBe(nonDefault)
  } finally {
    THEME_LOADERS[nonDefault] = original as () => Promise<unknown>
    errorSpy.mockRestore()
  }
})
