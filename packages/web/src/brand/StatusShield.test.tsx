import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { StatusShield } from "./StatusShield.js"

/**
 * kenzen#90: renders the three variants and asserts the expected `--rb-*` token names on the
 * glyph's `stroke` -- and, since the shield outline is variant-independent, that its own
 * `fill`/`stroke` tokens (`--rb-text`/`--rb-bg`) never change with the glyph colour.
 */

test("healthy renders the success token on its glyph stroke", () => {
  const { container } = render(<StatusShield variant="healthy" />)
  const glyph = container.querySelector("svg > g")
  expect(glyph).toHaveAttribute("stroke", "var(--rb-success)")
})

test("vulnerable renders the danger token on its glyph stroke", () => {
  const { container } = render(<StatusShield variant="vulnerable" />)
  const glyph = container.querySelector("svg > g")
  expect(glyph).toHaveAttribute("stroke", "var(--rb-danger)")
})

test("attention renders the warning token on its glyph stroke", () => {
  const { container } = render(<StatusShield variant="attention" />)
  const glyph = container.querySelector("svg > g")
  expect(glyph).toHaveAttribute("stroke", "var(--rb-warning)")
})

test("the shield body and inset outline use text/bg tokens regardless of variant", () => {
  const { container } = render(<StatusShield variant="attention" />)
  const paths = container.querySelectorAll("svg > path")
  expect(paths[0]).toHaveAttribute("fill", "var(--rb-text)")
  expect(paths[1]).toHaveAttribute("stroke", "var(--rb-bg)")
})

test("a title renders role=img and a real <title>", () => {
  const { container } = render(<StatusShield variant="healthy" title="Healthy" />)
  const svg = container.querySelector("svg")
  expect(svg).toHaveAttribute("role", "img")
  expect(svg?.querySelector("title")?.textContent).toBe("Healthy")
})

test("without a title, the svg is aria-hidden with no role", () => {
  const { container } = render(<StatusShield variant="healthy" />)
  const svg = container.querySelector("svg")
  expect(svg).toHaveAttribute("aria-hidden", "true")
  expect(svg).not.toHaveAttribute("role")
  expect(svg?.querySelector("title")).toBeNull()
})
