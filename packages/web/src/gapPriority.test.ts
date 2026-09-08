import { expect, test } from "vitest"
import { gapPriority } from "./gapPriority.js"

test("orders gap severity major < minor < patch < unknown < none", () => {
  const values = ["none", "unknown", "patch", "major", "minor"]
  const sorted = [...values].sort((a, b) => gapPriority(a) - gapPriority(b))
  expect(sorted).toEqual(["major", "minor", "patch", "unknown", "none"])
})

test("unknown ranks ahead of none, not buried behind it (round 2: matches Tooling's own precedent)", () => {
  expect(gapPriority("unknown")).toBeLessThan(gapPriority("none"))
})

test("a null gap sorts as unknown", () => {
  expect(gapPriority(null)).toBe(gapPriority("unknown"))
})

test("an unrecognized gap string also sorts as unknown, not first", () => {
  expect(gapPriority("not-a-real-gap")).toBe(gapPriority("unknown"))
  expect(gapPriority("not-a-real-gap")).toBeGreaterThan(gapPriority("major"))
})
