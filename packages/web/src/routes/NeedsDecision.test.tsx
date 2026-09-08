import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { NeedsDecision } from "./NeedsDecision.js"

test("renders the fixture item's repo, kind, name, and gap", () => {
  render(<NeedsDecision />)
  expect(screen.getByText(/Rackbops\/Tooling · pip-dep requests/)).toBeInTheDocument()
  expect(screen.getByText(/2\.31\.0 → 2\.32\.3 \(minor\)/)).toBeInTheDocument()
})
