import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { History } from "./History.js"

test("renders the fixture history entry's snapshot date and pin/gap", () => {
  render(<History />)
  expect(screen.getByText("2026-09-01T00:00:00Z")).toBeInTheDocument()
  expect(screen.getByText(/2\.31\.0 → 2\.32\.3 \(minor\)/)).toBeInTheDocument()
})
