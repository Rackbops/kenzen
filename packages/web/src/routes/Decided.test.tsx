import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { Decided } from "./Decided.js"

test("renders the fixture decision's repo, name, skip target, and who/when", () => {
  render(<Decided />)
  expect(screen.getByText(/Rackbops\/Tooling · requests/)).toBeInTheDocument()
  expect(screen.getByText(/Skipped until > 2\.32\.0/)).toBeInTheDocument()
  expect(screen.getByText(/roshne, 2026-09-01T00:00:00Z/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument()
})
