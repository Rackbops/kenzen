import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { KoiMark } from "./KoiMark.js"

/** Drawn shapes only -- excludes the `<clipPath>`'s own `<path>` in `<defs>`, which is plumbing
 * for the facet clip, not a visible mark of the drawing. */
function drawnShapes(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll("path, circle")).filter((el) => !el.closest("defs"))
}

test("renders an SVG on the mark's 64x64 drawing grid", () => {
  const { container } = render(<KoiMark />)
  const svg = container.querySelector("svg")
  expect(svg).not.toBeNull()
  expect(svg).toHaveAttribute("viewBox", "0 0 64 64")
})

test("a title renders <title> and role=img -- an accessible, non-decorative mark", () => {
  const { container } = render(<KoiMark title="Kenzen" />)
  const svg = container.querySelector("svg")
  expect(svg).toHaveAttribute("role", "img")
  expect(svg).not.toHaveAttribute("aria-hidden")
  expect(container.querySelector("title")?.textContent).toBe("Kenzen")
})

test("no title -- purely decorative, aria-hidden and no <title> or role", () => {
  const { container } = render(<KoiMark />)
  const svg = container.querySelector("svg")
  expect(svg).toHaveAttribute("aria-hidden", "true")
  expect(svg).not.toHaveAttribute("role")
  expect(container.querySelector("title")).toBeNull()
})

test("size sets both the width and height attributes", () => {
  const { container } = render(<KoiMark size={22} />)
  const svg = container.querySelector("svg")
  expect(svg).toHaveAttribute("width", "22")
  expect(svg).toHaveAttribute("height", "22")
})

test("size defaults to 24 when omitted", () => {
  const { container } = render(<KoiMark />)
  const svg = container.querySelector("svg")
  expect(svg).toHaveAttribute("width", "24")
  expect(svg).toHaveAttribute("height", "24")
})

test("kenzen#89 round 2: below 24px, the mark drops to fewer elements -- facets, circuit trace, and the pectoral fin don't survive that small", () => {
  const { container: small } = render(<KoiMark size={16} />)
  const { container: full } = render(<KoiMark size={64} />)
  expect(drawnShapes(small).length).toBeLessThan(drawnShapes(full).length)
})

test("kenzen#89 round 2: at 24px and above, the full element set renders (dorsal, pectoral, all three facets, the trace and its via dot)", () => {
  const { container } = render(<KoiMark size={24} />)
  const shapes = drawnShapes(container)
  // tail + body + dorsal + pectoral + 3 facets + spine + trace = 9 <path>s, + trace-dot + eye +
  // eye-highlight = 3 <circle>s.
  expect(shapes.filter((el) => el.tagName === "path")).toHaveLength(9)
  expect(shapes.filter((el) => el.tagName === "circle")).toHaveLength(3)
})

test("kenzen#89 round 2: below 24px, only the tail, body, spine glow, and eye survive", () => {
  const { container } = render(<KoiMark size={16} />)
  const shapes = drawnShapes(container)
  // tail + body + spine = 3 <path>s, + eye + eye-highlight = 2 <circle>s.
  expect(shapes.filter((el) => el.tagName === "path")).toHaveLength(3)
  expect(shapes.filter((el) => el.tagName === "circle")).toHaveLength(2)
})

test("mono swaps every themed fill/stroke to currentColor, keeping only the bg cut-outs as var(--rb-bg)", () => {
  const { container } = render(<KoiMark mono />)
  const svg = container.querySelector("svg") as SVGSVGElement
  const fillsAndStrokes = Array.from(svg.querySelectorAll("[fill], [stroke]")).flatMap((el) => [
    el.getAttribute("fill"),
    el.getAttribute("stroke"),
  ])
  // No `--rb-accent`/`--rb-success`/`--rb-text` token survives in mono mode.
  expect(fillsAndStrokes.some((v) => v?.includes("--rb-accent"))).toBe(false)
  expect(fillsAndStrokes.some((v) => v?.includes("--rb-success"))).toBe(false)
  expect(fillsAndStrokes.some((v) => v?.includes("--rb-text"))).toBe(false)
  // The body carries currentColor, not a fixed colour.
  const body = drawnShapes(container).find((el) => el.tagName === "path") as SVGPathElement
  expect(body).toHaveAttribute("fill", "currentColor")
})

test("non-mono uses --rb-* tokens throughout, never a literal hex or currentColor", () => {
  const { container } = render(<KoiMark />)
  const svg = container.querySelector("svg") as SVGSVGElement
  const values = Array.from(svg.querySelectorAll("[fill], [stroke]")).flatMap((el) => [
    el.getAttribute("fill"),
    el.getAttribute("stroke"),
  ])
  for (const value of values) {
    if (value === null || value === "none") continue
    expect(value.startsWith("var(--rb-")).toBe(true)
  }
})
