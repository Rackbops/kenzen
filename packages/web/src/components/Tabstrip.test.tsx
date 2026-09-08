import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { expect, test, vi } from "vitest"
import { Tabstrip } from "./Tabstrip.js"

const TABS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
  { id: "c", label: "Gamma" },
]

/** A controlled host, since Tabstrip deliberately holds no state of its own. */
function Harness({ initial = "a" }: { initial?: string }) {
  const [selected, setSelected] = useState(initial)
  return <Tabstrip tabs={TABS} selected={selected} onSelect={setSelected} label="Example" />
}

test("renders one tab per entry, marking only the selected one", () => {
  render(<Harness />)
  expect(screen.getAllByRole("tab")).toHaveLength(3)
  expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")
  expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "false")
})

test("the strip is a single tab stop -- only the selected tab is reachable by Tab", () => {
  // Roving tabIndex: without it a keyboard user tabs through every tab to reach the panel.
  render(<Harness />)
  expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("tabindex", "0")
  expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("tabindex", "-1")
})

test("clicking a tab reports it", () => {
  const onSelect = vi.fn()
  render(<Tabstrip tabs={TABS} selected="a" onSelect={onSelect} label="Example" />)
  fireEvent.click(screen.getByRole("tab", { name: "Beta" }))
  expect(onSelect).toHaveBeenCalledWith("b")
})

test("the tablist is named for assistive tech", () => {
  render(<Harness />)
  expect(screen.getByRole("tablist")).toHaveAccessibleName("Example")
})

test("a badge renders beside its label", () => {
  render(
    <Tabstrip
      tabs={[{ id: "a", label: "Alpha", badge: 7 }]}
      selected="a"
      onSelect={() => {}}
      label="Example"
    />,
  )
  expect(screen.getByRole("tab", { name: /Alpha/ })).toHaveTextContent("7")
})

test("a zero badge still renders -- it is a real count, not an absent one", () => {
  // `badge && ...` would hide 0, which is exactly the count a user most wants to see on an
  // empty tab.
  render(
    <Tabstrip
      tabs={[{ id: "a", label: "Alpha", badge: 0 }]}
      selected="a"
      onSelect={() => {}}
      label="Example"
    />,
  )
  expect(screen.getByRole("tab", { name: /Alpha/ })).toHaveTextContent("0")
})

// --- the ARIA keyboard contract -----------------------------------------------------------
test("arrow keys move between tabs and wrap at both ends", () => {
  render(<Harness />)
  const tablist = screen.getByRole("tablist")

  fireEvent.keyDown(tablist, { key: "ArrowRight" })
  expect(screen.getByRole("tab", { name: "Beta" })).toHaveAttribute("aria-selected", "true")

  fireEvent.keyDown(tablist, { key: "ArrowLeft" })
  expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")

  // Wraps backwards off the first tab to the last, rather than doing nothing.
  fireEvent.keyDown(tablist, { key: "ArrowLeft" })
  expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true")

  // ...and forwards off the last back to the first.
  fireEvent.keyDown(tablist, { key: "ArrowRight" })
  expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")
})

test("Home and End jump to the first and last tab", () => {
  render(<Harness initial="b" />)
  const tablist = screen.getByRole("tablist")

  fireEvent.keyDown(tablist, { key: "End" })
  expect(screen.getByRole("tab", { name: "Gamma" })).toHaveAttribute("aria-selected", "true")

  fireEvent.keyDown(tablist, { key: "Home" })
  expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true")
})

test("an unrelated key changes nothing", () => {
  const onSelect = vi.fn()
  render(<Tabstrip tabs={TABS} selected="a" onSelect={onSelect} label="Example" />)
  fireEvent.keyDown(screen.getByRole("tablist"), { key: "x" })
  expect(onSelect).not.toHaveBeenCalled()
})

test("a selected id not present in tabs leaves the keyboard handler inert", () => {
  // Defensive: a caller mid-reload could pass a stale id. Moving from "nowhere" would
  // otherwise land on an arbitrary tab.
  const onSelect = vi.fn()
  render(<Tabstrip tabs={TABS} selected="gone" onSelect={onSelect} label="Example" />)
  fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" })
  expect(onSelect).not.toHaveBeenCalled()
})
