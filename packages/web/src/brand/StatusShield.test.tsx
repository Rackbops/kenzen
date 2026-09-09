import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { StatusShield } from "./StatusShield.js"

/**
 * kenzen#90 rework: real-artwork cutouts, not a hand-drawn SVG (see StatusShield.tsx's own
 * doc comment) -- these tests match KoiMark.test.tsx's shape: assert each variant's `src`,
 * `width`/`height`, and the title-driven `alt`/decorative contract, rather than SVG internals
 * that no longer exist.
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
  const { container } = render(<StatusShield variant="healthy" size={20} />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("width", "20")
  expect(img).toHaveAttribute("height", "20")
})

test("size defaults to 14 when omitted", () => {
  const { container } = render(<StatusShield variant="healthy" />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("width", "14")
  expect(img).toHaveAttribute("height", "14")
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
