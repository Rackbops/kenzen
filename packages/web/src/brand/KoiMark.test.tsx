import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { KoiMark } from "./KoiMark.js"

test("renders the real-artwork cutout as an image, decorative (empty alt) next to the wordmark text", () => {
  const { container } = render(<KoiMark />)
  const img = container.querySelector("img")
  expect(img).not.toBeNull()
  expect(img).toHaveAttribute("src", "/brand/koi-64.png")
  expect(img).toHaveAttribute("alt", "")
})

test("size sets both the width and height attributes", () => {
  const { container } = render(<KoiMark size={22} />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("width", "22")
  expect(img).toHaveAttribute("height", "22")
})

test("size defaults to 24 when omitted", () => {
  const { container } = render(<KoiMark />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute("width", "24")
  expect(img).toHaveAttribute("height", "24")
})
