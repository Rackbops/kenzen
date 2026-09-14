import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { SchemeContext } from "../scheme.js"
import { StatusShield } from "./StatusShield.js"

/**
 * kenzen#90 rework: real-artwork cutouts, not a hand-drawn SVG (see StatusShield.tsx's own
 * doc comment) -- these tests match KoiMark.test.tsx's shape: assert each variant's `src`,
 * `width`/`height`, and the title-driven `alt`/decorative contract, rather than SVG internals
 * that no longer exist.
 *
 * kenzen#128: every test in this file renders with NO `SchemeContext` provider, so
 * `useScheme()` reads the context's own "light" default and every assertion below is against
 * the original (unchanged, navy) artwork -- exactly what a route-level test (which renders a
 * route component directly, never through `<App>`) already does today. The dark-scheme path
 * gets its own tests further down, each wrapped in a real `SchemeContext.Provider`.
 */

test("healthy renders the real-artwork cutout for that variant", () => {
  const { container } = render(<StatusShield variant="healthy" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("src", "/brand/shield-healthy-32.png")
})

test("vulnerable renders the real-artwork cutout for that variant", () => {
  const { container } = render(<StatusShield variant="vulnerable" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("src", "/brand/shield-vulnerable-32.png")
})

test("attention renders the real-artwork cutout for that variant", () => {
  const { container } = render(<StatusShield variant="attention" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("src", "/brand/shield-attention-32.png")
})

test("size sets both the width and height attributes", () => {
  // kenzen#124 review: this must use a value OTHER than the default (20) -- otherwise a
  // component that ignored the `size` prop entirely and hardcoded 20 would pass both this
  // test and "defaults to 20 when omitted" identically, so neither could tell "prop respected"
  // apart from "prop ignored".
  const { container } = render(<StatusShield variant="healthy" size={32} />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("width", "32")
  expect(img).toHaveAttribute("height", "32")
})

test("size defaults to 24 when omitted", () => {
  const { container } = render(<StatusShield variant="healthy" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("width", "24")
  expect(img).toHaveAttribute("height", "24")
})

test("a title becomes the accessible name (alt) and a hover tooltip (title)", () => {
  const { container } = render(<StatusShield variant="healthy" title="Healthy" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("alt", "Healthy")
  expect(img).toHaveAttribute("title", "Healthy")
})

test("without a title, the image is decorative (empty alt, no title attribute)", () => {
  const { container } = render(<StatusShield variant="healthy" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("alt", "")
  expect(img).not.toHaveAttribute("title")
})

// --- kenzen#128: the -ondark asset on a dark-scheme theme -------------------------------

test("on a dark-scheme theme, renders the -ondark asset with a 2x srcset to the -ondark-64 file", () => {
  const { container } = render(
    <SchemeContext.Provider value="dark">
      <StatusShield variant="vulnerable" />
    </SchemeContext.Provider>,
  )
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("src", "/brand/shield-vulnerable-ondark-32.png")
  expect(img).toHaveAttribute("srcset", "/brand/shield-vulnerable-ondark-64.png 2x")
})

test("on a light-scheme theme (explicit provider), renders today's original asset", () => {
  const { container } = render(
    <SchemeContext.Provider value="light">
      <StatusShield variant="vulnerable" />
    </SchemeContext.Provider>,
  )
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("src", "/brand/shield-vulnerable-32.png")
  expect(img).toHaveAttribute("srcset", "/brand/shield-vulnerable-64.png 2x")
})

test("with no provider at all, renders today's original asset -- same default as an explicit light provider", () => {
  const { container } = render(<StatusShield variant="vulnerable" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("src", "/brand/shield-vulnerable-32.png")
})
