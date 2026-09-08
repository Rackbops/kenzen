import { fireEvent, render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"
import type { ReportItem } from "./api.js"
import { applyItemFilters, ItemFilters } from "./ItemFilters.js"

function item(overrides: Partial<ReportItem>): ReportItem {
  return {
    key: "k",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    name: "requests",
    pinned: "1.0.0",
    pinStyle: "exact",
    role: "runtime",
    source: "requirements.txt:1",
    latest: "1.0.0",
    latestInMajor: "1.0.0",
    gap: "none",
    advisoryStatus: "none",
    advisories: [],
    assumed: null,
    note: null,
    decision: null,
    ...overrides,
  }
}

const ITEMS: ReportItem[] = [
  item({
    key: "a",
    repo: "Rackbops/Tooling",
    kind: "pip-dep",
    role: "runtime",
    advisoryStatus: "none",
  }),
  item({
    key: "b",
    repo: "Rackbops/kenzen",
    kind: "npm-dep",
    role: "build",
    advisoryStatus: "affected",
  }),
]

test("applyItemFilters with no filters returns every item unchanged", () => {
  expect(applyItemFilters(ITEMS, {})).toEqual(ITEMS)
})

test("applyItemFilters narrows by a single dimension", () => {
  expect(applyItemFilters(ITEMS, { repo: "Rackbops/kenzen" })).toEqual([ITEMS[1]])
})

test("applyItemFilters combines multiple dimensions with AND", () => {
  expect(applyItemFilters(ITEMS, { repo: "Rackbops/kenzen", role: "runtime" })).toEqual([])
  expect(applyItemFilters(ITEMS, { repo: "Rackbops/kenzen", role: "build" })).toEqual([ITEMS[1]])
})

test("renders one select per requested dimension, with All plus the distinct present values", () => {
  render(<ItemFilters items={ITEMS} value={{}} onChange={() => {}} dimensions={["repo", "role"]} />)
  expect(screen.getByLabelText("Repo")).toBeInTheDocument()
  expect(screen.getByLabelText("Role")).toBeInTheDocument()
  expect(screen.queryByLabelText("Kind")).not.toBeInTheDocument()

  const repoSelect = screen.getByLabelText("Repo") as HTMLSelectElement
  const optionValues = Array.from(repoSelect.options).map((o) => o.value)
  expect(optionValues).toEqual(
    ["", "Rackbops/Tooling", "Rackbops/kenzen"].sort((a, b) => a.localeCompare(b)),
  )
})

test("choosing a filter option calls onChange with that dimension set, others preserved", () => {
  const onChange = vi.fn()
  render(
    <ItemFilters
      items={ITEMS}
      value={{ role: "runtime" }}
      onChange={onChange}
      dimensions={["repo", "role"]}
    />,
  )
  fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "Rackbops/kenzen" } })
  expect(onChange).toHaveBeenCalledWith({ role: "runtime", repo: "Rackbops/kenzen" })
})

test("choosing All clears that dimension back to undefined", () => {
  const onChange = vi.fn()
  render(
    <ItemFilters
      items={ITEMS}
      value={{ repo: "Rackbops/kenzen" }}
      onChange={onChange}
      dimensions={["repo"]}
    />,
  )
  fireEvent.change(screen.getByLabelText("Repo"), { target: { value: "" } })
  expect(onChange).toHaveBeenCalledWith({ repo: undefined })
})
