import { expect, test } from "vitest"
import { gapPriority } from "./gapPriority.js"

test("orders gap severity major < minor < patch < none < unknown", () => {
  const values = ["none", "unknown", "patch", "major", "minor"]
  const sorted = [...values].sort((a, b) => gapPriority(a) - gapPriority(b))
  expect(sorted).toEqual(["major", "minor", "patch", "none", "unknown"])
})

test("a null gap sorts as unknown, last", () => {
  expect(gapPriority(null)).toBe(gapPriority("unknown"))
})

test("an unrecognized gap string also sorts as unknown, not first", () => {
  expect(gapPriority("not-a-real-gap")).toBe(gapPriority("unknown"))
})
