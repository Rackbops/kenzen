import { expect, test } from "vitest"
import { sourceUrl } from "./sourceLink.js"

test("builds a GitHub blob URL with a line anchor from repo + path:line", () => {
  expect(sourceUrl("Rackbops/Tooling", "requirements.txt:3")).toBe(
    "https://github.com/Rackbops/Tooling/blob/main/requirements.txt#L3",
  )
})

test("handles a nested path containing its own colons and slashes correctly", () => {
  expect(sourceUrl("Rackbops/kenzen", "packages/server/Dockerfile:12")).toBe(
    "https://github.com/Rackbops/kenzen/blob/main/packages/server/Dockerfile#L12",
  )
})

test("returns null for a source with no line number", () => {
  expect(sourceUrl("Rackbops/Tooling", "requirements.txt")).toBeNull()
})

test("returns null for a source with a non-numeric suffix after the last colon", () => {
  expect(sourceUrl("Rackbops/Tooling", "requirements.txt:abc")).toBeNull()
})

test("returns null for a source ending in a bare colon", () => {
  expect(sourceUrl("Rackbops/Tooling", "requirements.txt:")).toBeNull()
})
