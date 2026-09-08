import { describe, expect, it } from "vitest"
import { getVersion } from "./version.js"

describe("getVersion", () => {
  it("reads a semver from packages/server's own package.json", () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })
})
