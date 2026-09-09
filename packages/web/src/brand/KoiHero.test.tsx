import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { KoiHero } from "./KoiHero.js"

test("renders the banner webp, decorative", () => {
  const { container } = render(<KoiHero />)
  const section = container.querySelector("section.kz-hero")
  expect(section).not.toBeNull()
  const img = section?.querySelector('img[src="/brand/koi-banner.webp"]')
  expect(img).not.toBeNull()
  expect(img).toHaveAttribute("alt", "")
})
