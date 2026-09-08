import { expect, test } from "vitest"
import { resolveVersion, serverVersion } from "../../../scripts/version-tag.mjs"

// The pin test for K4-6 (Tooling#478): the release tag and the source-of-truth version in
// packages/server/package.json must agree, or release.yml fails the publish.

test("resolveVersion returns the version for a matching v-prefixed tag", () => {
  expect(resolveVersion("v0.1.0-alpha.1", "0.1.0-alpha.1")).toBe("0.1.0-alpha.1")
  expect(resolveVersion("v1.2.3", "1.2.3")).toBe("1.2.3")
})

test("resolveVersion throws when the tag and the package version disagree", () => {
  // The acceptance mutation: a tag that doesn't match packages/server/package.json fails the publish.
  expect(() => resolveVersion("v0.1.0-alpha.1", "0.0.0")).toThrow(/mismatch/)
  expect(() => resolveVersion("v0.1.0", "0.1.0-alpha.1")).toThrow(/mismatch/)
})

test("resolveVersion rejects a tag that is not a v-prefixed version", () => {
  expect(() => resolveVersion("0.1.0", "0.1.0")).toThrow(/v-prefixed/)
  expect(() => resolveVersion("release-0.1.0", "0.1.0")).toThrow(/v-prefixed/)
})

test("the committed server version round-trips through its own v-tag", () => {
  const v = serverVersion()
  expect(v).toMatch(/^\d+\.\d+\.\d+/) // a real semver
  expect(resolveVersion(`v${v}`, v)).toBe(v)
})
