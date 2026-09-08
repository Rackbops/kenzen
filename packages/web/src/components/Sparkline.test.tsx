import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { Sparkline } from "./Sparkline.js"

test("renders nothing for zero points", () => {
  const { container } = render(<Sparkline values={[]} label="empty" />)
  expect(container).toBeEmptyDOMElement()
})

test("renders nothing for a single point -- no trend to draw", () => {
  const { container } = render(<Sparkline values={[5]} label="one point" />)
  expect(container).toBeEmptyDOMElement()
})

test("renders an accessible svg for two or more points", () => {
  render(<Sparkline values={[1, 5, 2]} label="3 snapshots, 1 to 2 behind" />)
  const svg = screen.getByRole("img", { name: "3 snapshots, 1 to 2 behind" })
  expect(svg.tagName.toLowerCase()).toBe("svg")
})

test("a rising series plots the last point higher (lower y) than the first -- SVG y grows downward", () => {
  const { container } = render(<Sparkline values={[0, 10]} label="rising" />)
  const points = container.querySelector("polyline")?.getAttribute("points") ?? ""
  const coords = points
    .trim()
    .split(" ")
    .map((pair) => pair.split(",").map(Number))
  const firstY = coords[0]?.[1]
  const lastY = coords[coords.length - 1]?.[1]
  expect(firstY).toBeGreaterThan(lastY ?? Number.POSITIVE_INFINITY)
})

test("a perfectly flat series draws a flat line at mid-height, not pinned to the bottom", () => {
  // Review consideration: naively normalizing (v - min) / (max - min) divides by zero when
  // every value is equal, and a naive fallback would pin the line to y = bottom, which reads
  // as "worst case" even for a flat value of 0. This must draw a MIDLINE instead.
  const { container } = render(<Sparkline values={[3, 3, 3]} label="flat" height={24} />)
  const points = container.querySelector("polyline")?.getAttribute("points") ?? ""
  const ys = points
    .trim()
    .split(" ")
    .map((pair) => Number(pair.split(",")[1]))
  for (const y of ys) {
    expect(y).toBeCloseTo(12, 0) // height 24, padding 2 -> midline at 2 + (24-4)/2 = 12
  }
})

test("plots exactly one coordinate per value, in the order given", () => {
  const { container } = render(<Sparkline values={[1, 2, 3, 4]} label="four points" />)
  const points = container.querySelector("polyline")?.getAttribute("points") ?? ""
  expect(points.trim().split(" ")).toHaveLength(4)
})

test("respects custom width and height", () => {
  render(<Sparkline values={[1, 2]} label="sized" width={200} height={40} />)
  const svg = screen.getByRole("img", { name: "sized" })
  expect(svg).toHaveAttribute("width", "200")
  expect(svg).toHaveAttribute("height", "40")
})
