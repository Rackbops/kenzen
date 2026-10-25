import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readFileOrNull } from "./read-file.js"

describe("readFileOrNull", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kenzen-readfile-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns the contents of a readable file", () => {
    const file = join(dir, "config.toml")
    writeFileSync(file, "port = 1\n")
    expect(readFileOrNull(file)).toBe("port = 1\n")
  })

  it("returns null for a missing path", () => {
    expect(readFileOrNull(join(dir, "absent.toml"))).toBeNull()
  })

  it("rethrows any other error (a directory is EISDIR, not 'no config')", () => {
    expect(() => readFileOrNull(dir)).toThrowError(expect.objectContaining({ code: "EISDIR" }))
  })
})
