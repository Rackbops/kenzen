import { describe, expect, it } from "vitest"
import { PACKAGE_NAME } from "./index.js"

describe("index", () => {
  it("exports its own package name", () => {
    expect(PACKAGE_NAME).toBe("@kenzen/server")
  })
})
