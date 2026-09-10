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

test("kenzen#112: carries a srcset up to 512px so a HiDPI display can pick a sharper asset than the 64px fallback", () => {
  const { container } = render(<KoiMark size={60} />)
  const img = container.querySelector("img")
  expect(img).toHaveAttribute(
    "srcset",
    "/brand/koi-64.png 64w, /brand/koi-192.png 192w, /brand/koi-512.png 512w",
  )
  expect(img).toHaveAttribute("sizes", "60px")
})
